#!/usr/bin/env python3
"""
E13 Offline Pixel Compositor - production-equivalent, performance-optimized.
Strategy: Pre-composite base+fragments+props+fg+lighting into one "full map".
Per-shot: determine agent depth vs each object, render agent, then re-render
any world-band objects (fragments AND props) that should occlude the agent.
"""
import os
from .png_io import load_image, write_png


class PixelBuffer:
    __slots__ = ('width', 'height', 'pixels')
    def __init__(self, width, height, pixels=None):
        self.width = width; self.height = height
        self.pixels = bytearray(width * height * 4) if pixels is None else bytearray(pixels)
    def to_bytes(self): return bytes(self.pixels)

    def blit_region(self, src_buf, sx, sy, sw, sh, dx, dy, dw=None, dh=None):
        sp = src_buf.pixels; dp = self.pixels; src_w = src_buf.width
        dw_v = dw if dw is not None else sw; dh_v = dh if dh is not None else sh
        for ry in range(dh_v):
            ty = dy + ry
            if ty < 0 or ty >= self.height: continue
            ssy = sy + int(ry * sh / dh_v)
            if ssy < 0 or ssy >= src_buf.height: continue
            sr = ssy * src_w * 4; dr = ty * self.width * 4
            for rx in range(dw_v):
                tx = dx + rx
                if tx < 0 or tx >= self.width: continue
                ssx = sx + int(rx * sw / dw_v)
                if ssx < 0 or ssx >= src_w: continue
                si = sr + ssx * 4; sa = sp[si + 3]
                if sa == 0: continue
                di = dr + tx * 4
                if sa == 255:
                    dp[di]=sp[si]; dp[di+1]=sp[si+1]; dp[di+2]=sp[si+2]; dp[di+3]=255
                else:
                    a=sa/255.0; inv=1.0-a
                    dp[di]=int(sp[si]*a+dp[di]*inv); dp[di+1]=int(sp[si+1]*a+dp[di+1]*inv)
                    dp[di+2]=int(sp[si+2]*a+dp[di+2]*inv); dp[di+3]=min(255,sa+int(dp[di+3]*inv))

    @staticmethod
    def from_image(filepath):
        w, h, c, px = load_image(filepath)
        return PixelBuffer(w, h, px)


class AssetCache:
    def __init__(self, public_dir):
        self.public_dir = public_dir; self._cache = {}
    def _load(self, key, path):
        if key not in self._cache: self._cache[key] = PixelBuffer.from_image(path)
        return self._cache[key]
    def base(self):
        return self._load('base', os.path.join(self.public_dir, 'images', 'liangshan-hall-base-clean-v3.webp'))
    def fg(self):
        return self._load('fg', os.path.join(self.public_dir, 'images', 'liangshan-hall-foreground-occluders-v3.webp'))
    def lt(self):
        return self._load('lt', os.path.join(self.public_dir, 'images', 'liangshan-hall-lighting-overlay-v3.webp'))
    def atlas(self, ref):
        k = f'atlas:{ref}'
        if k not in self._cache: self._cache[k] = PixelBuffer.from_image(os.path.join(self.public_dir, ref))
        return self._cache[k]
    def prop_img(self, ref):
        k = f'prop:{ref}'
        if k not in self._cache: self._cache[k] = PixelBuffer.from_image(os.path.join(self.public_dir, ref))
        return self._cache[k]
    def persona_sheet(self, code):
        k = f'sprite:{code}'
        if k not in self._cache:
            from .world_model import PERSONA_SPRITE
            info = PERSONA_SPRITE.get(code)
            if not info: raise ValueError(f'Unknown persona: {code}')
            self._cache[k] = PixelBuffer.from_image(os.path.join(self.public_dir, 'sprites', 'persona-sheets-v1', info['src']))
        return self._cache[k]


class OfflineRenderer:
    MAP_W = 1664; MAP_H = 928

    def __init__(self, public_dir):
        self.assets = AssetCache(public_dir)
        self._full_composite = None

    def _build_full_composite(self, fragments, props_list):
        if self._full_composite is not None:
            return
        import time
        t0 = time.time()
        from .world_model import base_order_sort
        all_static = list(fragments) + list(props_list)
        sorted_static = base_order_sort(all_static)
        comp = PixelBuffer(self.MAP_W, self.MAP_H)
        bp = self.assets.base().pixels
        comp.pixels[:] = bp
        for obj in sorted_static:
            if obj.get('kind') == 'prop':
                self._blit_prop(comp, obj)
            else:
                self._blit_fragment(comp, obj)
        fgp = self.assets.fg().pixels; dp = comp.pixels
        n = self.MAP_W * self.MAP_H
        for i in range(0, n*4, 4):
            fsa = fgp[i+3]
            if fsa == 255:
                dp[i]=fgp[i]; dp[i+1]=fgp[i+1]; dp[i+2]=fgp[i+2]; dp[i+3]=255
            elif fsa > 0:
                fa = fsa/255.0; inv = 1.0-fa
                dp[i]=int(fgp[i]*fa+dp[i]*inv); dp[i+1]=int(fgp[i+1]*fa+dp[i+1]*inv)
                dp[i+2]=int(fgp[i+2]*fa+dp[i+2]*inv); dp[i+3]=min(255,fsa+int(dp[i+3]*inv))
        ltp = self.assets.lt().pixels
        for i in range(0, n*4, 4):
            lsa = ltp[i+3]
            if lsa > 0:
                af = (lsa/255.0)*0.45
                v = 255-int((255-dp[i])*(255-ltp[i])/255*af); dp[i]=max(0,min(255,v))
                v = 255-int((255-dp[i+1])*(255-ltp[i+1])/255*af); dp[i+1]=max(0,min(255,v))
                v = 255-int((255-dp[i+2])*(255-ltp[i+2])/255*af); dp[i+2]=max(0,min(255,v))
                dp[i+3]=min(255,dp[i+3]+int(lsa*0.45))
        self._full_composite = comp
        print(f'Full composite built in {time.time()-t0:.1f}s')

    def _blit_fragment(self, canvas, frag):
        ar = frag.get('assetRef', '')
        if not ar: return
        try: atlas = self.assets.atlas(ar)
        except: return
        s = frag['sourceRect']; d = frag['destinationRect']
        canvas.blit_region(atlas, int(s['x']), int(s['y']), int(s['width']), int(s['height']),
            int(d['x']), int(d['y']), int(d['width']), int(d['height']))

    def _blit_prop(self, canvas, prop):
        ar = prop.get('assetRef', '')
        if not ar: return
        try: img = self.assets.prop_img(ar)
        except: return
        d = prop['destinationRect']
        canvas.blit_region(img, 0, 0, img.width, img.height,
            int(d['x']), int(d['y']), int(d['width']), int(d['height']))

    def render_shot(self, shot, fragments, props_list):
        """Render standard viewport crop (used by tests)."""
        from .world_model import (
            build_agent_scene_object, compute_unified_order,
            compute_world_sort_key, PERSONA_SPRITE, PERSONAS,
        )
        self._build_full_composite(fragments, props_list)
        agent = build_agent_scene_object(shot['persona'], shot['world']['x'], shot['world']['y'])
        sorted_objects, depths = compute_unified_order(fragments, props_list, agent)
        camera = shot['camera']; vp = shot['viewport']
        zoom = camera['zoom']; cx, cy = camera['center']['x'], camera['center']['y']
        vpw = int(vp['width'] / zoom); vph = int(vp['height'] / zoom)
        wx = max(0, min(int(cx - vpw/2), self.MAP_W - vpw))
        wy = max(0, min(int(cy - vph/2), self.MAP_H - vph))
        cw = min(vpw, self.MAP_W - wx); ch = min(vph, self.MAP_H - wy)
        canvas = PixelBuffer(cw, ch)
        sp = self._full_composite.pixels; dp = canvas.pixels
        for cy_i in range(ch):
            src = ((wy + cy_i) * self.MAP_W + wx) * 4
            dst = cy_i * cw * 4
            dp[dst:dst+cw*4] = sp[src:src+cw*4]
        agent_sid = agent['stableId']; agent_depth = depths.get(agent_sid, 0)
        covering = []
        for obj in sorted_objects:
            sid = obj.get('stableId', '')
            if sid == agent_sid: continue
            d = depths.get(sid, 0)
            if d > agent_depth and self._obj_overlaps(obj, (wx, wy, cw, ch)):
                covering.append(obj)
        self._render_agent_vp(canvas, agent, wx, wy)
        for obj in covering:
            if obj.get('kind') == 'prop':
                self._render_prop_vp(canvas, obj, wx, wy)
            else:
                self._render_fragment_vp(canvas, obj, wx, wy)
        return self._build_facts(canvas, sorted_objects, depths, agent, shot, fragments, props_list, wx, wy, cw, ch)

    def render_shot_small(self, shot, fragments, props_list, crop_w=400, crop_h=300):
        """Render small crop centered on agent-target midpoint."""
        from .world_model import (
            build_agent_scene_object, compute_unified_order,
            compute_world_sort_key, PERSONA_SPRITE, PERSONAS,
        )
        self._build_full_composite(fragments, props_list)
        agent = build_agent_scene_object(shot['persona'], shot['world']['x'], shot['world']['y'])
        sorted_objects, depths = compute_unified_order(fragments, props_list, agent)
        ax = shot['world']['x']; ay = shot['world']['y']
        tx = shot['targetAnchor']['x']; ty = shot['targetAnchor']['y']
        cx = int((ax + tx) / 2); cy = int((ay + ty) / 2)
        wx = max(0, min(cx - crop_w//2, self.MAP_W - crop_w))
        wy = max(0, min(cy - crop_h//2, self.MAP_H - crop_h))
        cw = min(crop_w, self.MAP_W - wx); ch = min(crop_h, self.MAP_H - wy)
        canvas = PixelBuffer(cw, ch)
        sp = self._full_composite.pixels; dp = canvas.pixels
        for cy_i in range(ch):
            src = ((wy + cy_i) * self.MAP_W + wx) * 4
            dst = cy_i * cw * 4
            dp[dst:dst+cw*4] = sp[src:src+cw*4]
        agent_sid = agent['stableId']; agent_depth = depths.get(agent_sid, 0)
        covering = []
        for obj in sorted_objects:
            sid = obj.get('stableId', '')
            if sid == agent_sid: continue
            d = depths.get(sid, 0)
            if d > agent_depth and self._obj_overlaps(obj, (wx, wy, cw, ch)):
                covering.append(obj)
        self._render_agent_vp(canvas, agent, wx, wy)
        for obj in covering:
            if obj.get('kind') == 'prop':
                self._render_prop_vp(canvas, obj, wx, wy)
            else:
                self._render_fragment_vp(canvas, obj, wx, wy)
        return self._build_facts(canvas, sorted_objects, depths, agent, shot, fragments, props_list, wx, wy, cw, ch)

    def _build_facts(self, canvas, sorted_objects, depths, agent, shot, fragments, props_list, wx, wy, cw, ch):
        from .world_model import compute_world_sort_key
        target_sid = shot['targetStableId']; agent_sid = agent['stableId']
        ad = depths.get(agent_sid); td = depths.get(target_sid)
        if ad is not None and td is not None:
            ordering = 'agent_behind_target' if ad < td else ('agent_in_front' if ad > td else 'tie')
        else:
            ordering = 'unknown'
        target_obj = next((o for o in fragments + props_list if o['stableId'] == target_sid), None)
        return canvas.to_bytes(), sorted_objects, depths, {
            'shotId': shot['id'], 'agentStableId': agent_sid, 'targetStableId': target_sid,
            'agentWorld': {'x': shot['world']['x'], 'y': shot['world']['y']},
            'agentSortKey': list(compute_world_sort_key(agent)),
            'targetSortKey': list(compute_world_sort_key(target_obj)) if target_obj else None,
            'actualDepth': ad, 'targetDepth': td, 'ordering': ordering,
            'expectedOrdering': shot['expectedRelation'], 'depthMatch': ordering == shot['expectedRelation'],
            'pixelOverlap': self._compute_overlap(agent, shot),
            'worldOrderLength': len(sorted_objects),
            'viewportWorld': {'x': wx, 'y': wy, 'width': cw, 'height': ch},
        }

    def _obj_overlaps(self, obj, vp):
        vx, vy, vw, vh = vp
        if obj.get('kind') == 'agent':
            ax = obj.get('worldX',0)-70; ay = obj.get('worldY',0)-110; aw=140; ah=130
        else:
            d = obj.get('destinationRect',{})
            ax=d.get('x',0); ay=d.get('y',0); aw=d.get('width',0); ah=d.get('height',0)
        return not (ax+aw<vx or ax>vx+vw or ay+ah<vy or ay>vy+vh)

    def _render_fragment_vp(self, c, f, vx, vy):
        ar = f.get('assetRef','')
        if not ar: return
        try: a = self.assets.atlas(ar)
        except: return
        s=f['sourceRect']; d=f['destinationRect']
        c.blit_region(a,int(s['x']),int(s['y']),int(s['width']),int(s['height']),
            int(d['x'])-vx,int(d['y'])-vy,int(d['width']),int(d['height']))

    def _render_prop_vp(self, c, p, vx, vy):
        ar = p.get('assetRef','')
        if not ar: return
        try: img = self.assets.prop_img(ar)
        except: return
        d=p['destinationRect']
        c.blit_region(img,0,0,img.width,img.height,int(d['x'])-vx,int(d['y'])-vy,int(d['width']),int(d['height']))

    def _render_agent_vp(self, c, a, vx, vy):
        pc = a.get('personaCode','')
        if not pc: return
        from .world_model import PERSONA_SPRITE, PERSONAS
        info = PERSONA_SPRITE.get(pc)
        pers = next((p for p in PERSONAS if p['personaCode']==pc),None)
        if not info or not pers: return
        try: sheet = self.assets.persona_sheet(pc)
        except: return
        fw,fh=info['frame_w'],info['frame_h']; sc=pers['scale']
        afx=info['anchor_x']*fw; afy=info['anchor_y']*fh
        c.blit_region(sheet,0,0,fw,fh,
            int(a['worldX']-afx*sc)-vx,int(a['worldY']-afy*sc)-vy,int(fw*sc),int(fh*sc))

    def _compute_overlap(self, agent, shot):
        from .world_model import PERSONA_SPRITE, PERSONAS
        pc=agent.get('personaCode','')
        info=PERSONA_SPRITE.get(pc)
        pers=next((p for p in PERSONAS if p['personaCode']==pc),None)
        if not info or not pers: return {'hasOverlap':False}
        sc=pers['scale']; afx=info['anchor_x']*info['frame_w']; afy=info['anchor_y']*info['frame_h']
        dw=int(info['frame_w']*sc); dh=int(info['frame_h']*sc)
        ax=int(agent['worldX']-afx*sc); ay=int(agent['worldY']-afy*sc)
        tr=shot.get('targetRect',{})
        tx=int(tr.get('x',0)); ty=int(tr.get('y',0)); tw=int(tr.get('width',0)); th=int(tr.get('height',0))
        ox=max(tx,ax); oy=max(ty,ay); ox2=min(tx+tw,ax+dw); oy2=min(ty+th,ay+dh)
        if ox>=ox2 or oy>=oy2: return {'hasOverlap':False,'overlapAlpha':0,'overlapBounds':None}
        return {'hasOverlap':True,'overlapBounds':{'x':ox,'y':oy,'width':ox2-ox,'height':oy2-oy}}
