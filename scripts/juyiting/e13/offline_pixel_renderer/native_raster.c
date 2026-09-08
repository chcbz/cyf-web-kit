#include <fenv.h>
#include <limits.h>
#include <math.h>
#include <stdint.h>

enum { BLEND_SOURCE_OVER = 0, BLEND_SCREEN = 1, BLEND_MULTIPLY = 2 };

int e13_test_set_round_downward(void) { return fesetround(FE_DOWNWARD); }
int e13_test_set_round_nearest(void) { return fesetround(FE_TONEAREST); }
int e13_test_get_rounding(void) { return fegetround(); }

static int64_t clamp_int64(int64_t value, int64_t low, int64_t high) {
  return value < low ? low : (value > high ? high : value);
}

static uint8_t round_byte(double value) {
  double rounded = nearbyint(value);
  if (rounded < 0.0) return 0;
  if (rounded > 255.0) return 255;
  return (uint8_t)rounded;
}

/*
 * Mirrors PixelBuffer._blit_region_reference byte-for-byte for valid source
 * rectangles. Keep each double expression ordered as in the Python scalar
 * implementation: this rasterizer is an acceleration, never an alternative
 * compositing model.
 */
int e13_blit_region(
    const uint8_t *sp, int src_w, int src_h,
    uint8_t *dp, int dst_w, int dst_h,
    int sx, int sy, int sw, int sh, int dx, int dy, int dw, int dh,
    double opacity, int blend, int smoothing,
    int has_clip, int clip_x, int clip_y, int clip_w, int clip_h) {
  if (src_w <= 0 || src_h <= 0 || dst_w <= 0 || dst_h <= 0 ||
      sx < 0 || sy < 0 || sw <= 0 || sh <= 0 ||
      (int64_t)sx + sw > src_w || (int64_t)sy + sh > src_h ||
      (int64_t)src_w * src_h > INT64_MAX / 4 ||
      (int64_t)dst_w * dst_h > INT64_MAX / 4) return -1;
  if (dw <= 0 || dh <= 0) return 0;
  int saved_round = fegetround();
  fesetround(FE_TONEAREST);
  int64_t ry0 = dy < 0 ? -(int64_t)dy : 0;
  int64_t ry1 = dh < (int64_t)dst_h - dy ? dh : (int64_t)dst_h - dy;
  int64_t rx0 = dx < 0 ? -(int64_t)dx : 0;
  int64_t rx1 = dw < (int64_t)dst_w - dx ? dw : (int64_t)dst_w - dx;
  if (has_clip) {
    int64_t clip_ry0 = (int64_t)clip_y - dy;
    int64_t clip_ry1 = (int64_t)clip_y + clip_h - dy;
    int64_t clip_rx0 = (int64_t)clip_x - dx;
    int64_t clip_rx1 = (int64_t)clip_x + clip_w - dx;
    if (ry0 < clip_ry0) ry0 = clip_ry0;
    if (ry1 > clip_ry1) ry1 = clip_ry1;
    if (rx0 < clip_rx0) rx0 = clip_rx0;
    if (rx1 > clip_rx1) rx1 = clip_rx1;
  }
  if (ry0 >= ry1 || rx0 >= rx1) goto restore_rounding;

  for (int64_t ry = ry0; ry < ry1; ++ry) {
    int64_t ty = (int64_t)dy + ry;
    int64_t ssy = (int64_t)sy + (int64_t)((double)ry * sh / dh);
    if (ssy < 0 || ssy >= src_h) continue;
    for (int64_t rx = rx0; rx < rx1; ++rx) {
      int64_t tx = (int64_t)dx + rx;
      double sc[3];
      double sa;
      if (smoothing && (dw != sw || dh != sh)) {
        double fx = (double)sx + ((double)rx + 0.5) * sw / dw - 0.5;
        double fy = (double)sy + ((double)ry + 0.5) * sh / dh - 0.5;
        int64_t x0 = clamp_int64((int64_t)floor(fx), sx, (int64_t)sx + sw - 1);
        int64_t y0 = clamp_int64((int64_t)floor(fy), sy, (int64_t)sy + sh - 1);
        int64_t x1 = clamp_int64(x0 + 1, sx, (int64_t)sx + sw - 1);
        int64_t y1 = clamp_int64(y0 + 1, sy, (int64_t)sy + sh - 1);
        double wx = fx - floor(fx);
        double wy = fy - floor(fy);
        double weights[4] = { (1 - wx) * (1 - wy), wx * (1 - wy), (1 - wx) * wy, wx * wy };
        int64_t xs[4] = { x0, x1, x0, x1 };
        int64_t ys[4] = { y0, y0, y1, y1 };
        double alpha = 0.0;
        for (int i = 0; i < 4; ++i) alpha += sp[(ys[i] * src_w + xs[i]) * 4 + 3] / 255.0 * weights[i];
        if (alpha <= 0.0) continue;
        for (int c = 0; c < 3; ++c) {
          double premul = 0.0;
          for (int i = 0; i < 4; ++i) {
            int64_t si = (ys[i] * src_w + xs[i]) * 4;
            premul += (sp[si + c] / 255.0) * (sp[si + 3] / 255.0) * weights[i];
          }
          sc[c] = premul / alpha;
        }
        sa = alpha * opacity;
      } else {
        int64_t ssx = (int64_t)sx + (int64_t)((double)rx * sw / dw);
        if (ssx < 0 || ssx >= src_w) continue;
        int64_t si = (ssy * src_w + ssx) * 4;
        sa = (sp[si + 3] / 255.0) * opacity;
        if (sa <= 0.0) continue;
        for (int c = 0; c < 3; ++c) sc[c] = sp[si + c] / 255.0;
      }
      int64_t di = (ty * dst_w + tx) * 4;
      double da = dp[di + 3] / 255.0;
      double out_a = sa + da * (1.0 - sa);
      if (out_a <= 0.0) continue;
      for (int c = 0; c < 3; ++c) {
        double dc = dp[di + c] / 255.0;
        double blended = blend == BLEND_SCREEN ? 1.0 - (1.0 - dc) * (1.0 - sc[c])
          : (blend == BLEND_MULTIPLY ? dc * sc[c] : sc[c]);
        double premul = sa * ((1.0 - da) * sc[c] + da * blended) + (1.0 - sa) * da * dc;
        dp[di + c] = round_byte(premul / out_a * 255.0);
      }
      dp[di + 3] = round_byte(out_a * 255.0);
    }
  }
restore_rounding:
  if (saved_round != -1) fesetround(saved_round);
  return 0;
}
