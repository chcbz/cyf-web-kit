import { createHash } from 'node:crypto'

export const ZERO_GENERATION_ID = '0'.repeat(64)
export const TMX_SHA256 = '291a38cc66ebd60c8577500a5afc18ce5398570fe4c35ca66d9eebe818826a97'
export const E9A_GENERATION_ID = '7f8bbdd8f3ca49952d0bcfceadf60a50ad998fc7033e370cbef665ee331f3d3b'
export const E9B_COMMIT = 'b8adb0988cd17f777e44064cf79c376cd9254b92'
export const BASE_COMMIT = 'b8adb0988cd17f777e44064cf79c376cd9254b92'
export const NAV_AREA = Object.freeze({ tmxId: 95, minX: 48, minY: 144, maxX: 1616, maxY: 864, width: 1568, height: 720 })

export const OWNER_BY_MASK = Object.freeze({
  48:'jyt.occ.west-upper.lantern-table-frame-01.v2',49:'jyt.occ.west-lower.long-table-frame-01.v2',50:'jyt.occ.west-lower.railing-02.v2',51:'jyt.occ.west-lower.wall-panel-assembly-01.v2',52:'jyt.occ.west-upper.wall-panel-assembly-01.v2',53:'jyt.occ.west-upper.wall-panel-assembly-01.v2',54:'jyt.occ.west-upper.pillar-01.v2',55:'jyt.occ.west-upper.diagonal-brace-01.v2',56:'jyt.occ.east-upper.diagonal-brace-01.v2',57:'jyt.occ.east-upper.pillar-01.v2',58:'jyt.occ.east-upper.wall-panel-upper-01.v2',59:'jyt.occ.east-lower.worktable-01.v2',60:'jyt.occ.east-lower.lantern-01.v2',61:'jyt.occ.entrance.lantern-post-01.v2',62:'jyt.occ.entrance.lantern-post-02.v2',63:'jyt.occ.entrance.hanging-banner-02.v2',64:'jyt.occ.entrance.hanging-banner-01.v2',65:'jyt.occ.west-lower.wall-bracket-01.v2',66:'jyt.occ.west-lower.railing-01.v2',67:'jyt.occ.west-lower.floor-lantern-01.v2',68:'jyt.occ.west-lower.wall-lantern-01.v2',69:'jyt.occ.west-upper.wall-sconce-02.v2',70:'jyt.occ.west-upper.lantern-01.v2',71:'jyt.occ.west-upper.wall-sconce-01.v2',72:'jyt.occ.center.wall-sconce-01.v2',73:'jyt.occ.east-upper.scroll-table-front-01.v2',74:'jyt.occ.east-lower.worktable-01.v2',75:'jyt.occ.east-lower.fabric-rack-01.v2',76:'jyt.occ.east-lower.diagonal-brace-01.v2',77:'jyt.occ.east-upper.pillar-02.v2',78:'jyt.occ.east-upper.wall-panel-lower-01.v2',79:'jyt.occ.east-lower.diagonal-brace-01.v2',80:'jyt.occ.east-upper.pillar-02.v2',81:'jyt.occ.east-lower.railing-post-01.v2',82:'jyt.occ.east-lower.diagonal-brace-02.v2',83:'jyt.occ.west-lower.diagonal-brace-02.v2',84:'jyt.occ.west-lower.wall-panel-assembly-01.v2'
})

export const VISUAL_BY_MASK = Object.freeze({
  48:'Northwest lantern table frame.',49:'West-lower long table frame.',50:'Southwest lower railing.',51:'Southwest wall-panel assembly; exact E9A owner pixels only, excluding independently owned table, railing, and lantern pixels.',52:'Large west-upper wall-panel assembly.',53:'Small legacy slice of the west-upper wall-panel assembly.',54:'West structural pillar.',55:'West-upper diagonal brace.',56:'East-upper diagonal brace.',57:'East upper structural pillar.',58:'East-upper architectural wall-panel owner. This is separate from prop TMX 92: the complete bounty-board table prop has bounds (1360,255,172x124), anchor (1446,379), tieBias -4, and zero opaque-pixel overlap with the legacy mask polygon.',59:'East-lower worktable owner.',60:'Southeast hanging lantern owner.',61:'Entrance right lantern post.',62:'Entrance left lantern post.',63:'Entrance right hanging banner.',64:'Entrance left hanging banner.',65:'West-lower wall bracket.',66:'West-lower railing.',67:'Southwest floor lantern.',68:'Southwest edge wall lantern.',69:'West-upper wall sconce.',70:'Northwest hanging lantern.',71:'North-center small wall sconce.',72:'Center-north wall sconce.',73:'East-upper scroll-table front panel.',74:'Small legacy corner of the east-lower worktable owner.',75:'Southeast fabric rack.',76:'East-lower primary diagonal brace; exact E9A owner pixels only, excluding nearby independently owned brace/worktable pixels.',77:'East pillar-02 upper/lower structural section.',78:'East-upper lower wall panel.',79:'Small legacy slice of east-lower diagonal brace-01.',80:'Pillar-02 lower extension whose target remains in east-upper.',81:'East-lower railing post.',82:'East-lower secondary diagonal brace.',83:'West-lower secondary diagonal brace.',84:'Small legacy slice of the west-lower wall-panel assembly.'
})

// Anchors use each accepted owner alpha contact line (max ownership row + 1), except
// owners below the TMX nav floor where the line is explicitly recalibrated to y=852.
export const PROBE_FIXTURES = Object.freeze({
48:{anchor:{x:285,y:351},behind:{x:337,y:338},boundary:{x:332,y:351},front:{x:332,y:367}},
49:{anchor:{x:178,y:719},behind:{x:209,y:704},boundary:{x:204,y:719},front:{x:204,y:735}},
50:{anchor:{x:155,y:824},behind:{x:206,y:808},boundary:{x:206,y:824},front:{x:216,y:825}},
51:{anchor:{x:218,y:852},behind:{x:254,y:839},boundary:{x:249,y:852},front:{x:249,y:864}},
52:{anchor:{x:274,y:716},behind:{x:274,y:700},boundary:{x:274,y:716},front:{x:274,y:732}},
53:{anchor:{x:274,y:716},behind:{x:492,y:700},boundary:{x:492,y:716},front:{x:489,y:732}},
54:{anchor:{x:571,y:469},behind:{x:577,y:453},boundary:{x:577,y:469},front:{x:590,y:489}},
55:{anchor:{x:608,y:489},behind:{x:618,y:473},boundary:{x:618,y:489},front:{x:618,y:505}},
56:{anchor:{x:1140,y:486},behind:{x:1140,y:470},boundary:{x:1140,y:486},front:{x:1127,y:502}},
57:{anchor:{x:1181,y:464},behind:{x:1181,y:448},boundary:{x:1181,y:464},front:{x:1188,y:480}},
58:{anchor:{x:1430,y:459},behind:{x:1430,y:443},boundary:{x:1430,y:459},front:{x:1430,y:479}},
59:{anchor:{x:1559,y:701},behind:{x:1516,y:686},boundary:{x:1520,y:701},front:{x:1520,y:717}},
60:{anchor:{x:1338,y:852},behind:{x:1357,y:836},boundary:{x:1357,y:852},front:{x:1360,y:864}},
61:{anchor:{x:1073,y:778},behind:{x:1073,y:762},boundary:{x:1073,y:778},front:{x:1073,y:780}},
62:{anchor:{x:1020,y:755},behind:{x:1014,y:739},boundary:{x:1014,y:755},front:{x:1014,y:771}},
63:{anchor:{x:951,y:796},behind:{x:927,y:780},boundary:{x:927,y:796},front:{x:926,y:811}},
64:{anchor:{x:791,y:794},behind:{x:803,y:778},boundary:{x:803,y:794},front:{x:803,y:810}},
65:{anchor:{x:704,y:714},behind:{x:717,y:698},boundary:{x:717,y:714},front:{x:717,y:730}},
66:{anchor:{x:593,y:778},behind:{x:480,y:762},boundary:{x:480,y:778},front:{x:480,y:794}},
67:{anchor:{x:381,y:852},behind:{x:351,y:836},boundary:{x:351,y:852},front:{x:348,y:864}},
68:{anchor:{x:35,y:741},behind:{x:48,y:725},boundary:{x:48,y:741},front:{x:50,y:743}},
69:{anchor:{x:515,y:585},behind:{x:511,y:569},boundary:{x:511,y:585},front:{x:507,y:601}},
70:{anchor:{x:484,y:240},behind:{x:490,y:224},boundary:{x:490,y:240},front:{x:486,y:270}},
71:{anchor:{x:624,y:272},behind:{x:624,y:256},boundary:{x:624,y:272},front:{x:622,y:288}},
72:{anchor:{x:1121,y:284},behind:{x:1121,y:268},boundary:{x:1121,y:284},front:{x:1121,y:300}},
73:{anchor:{x:1432,y:284},behind:{x:1395,y:268},boundary:{x:1395,y:284},front:{x:1379,y:285}},
74:{anchor:{x:1559,y:701},behind:{x:1602,y:685},boundary:{x:1602,y:701},front:{x:1602,y:717}},
75:{anchor:{x:1631,y:830},behind:{x:1611,y:814},boundary:{x:1611,y:830},front:{x:1602,y:846}},
76:{anchor:{x:1410,y:768},behind:{x:1423,y:752},boundary:{x:1423,y:768},front:{x:1424,y:769}},
77:{anchor:{x:1227,y:703},behind:{x:1215,y:687},boundary:{x:1215,y:703},front:{x:1215,y:719}},
78:{anchor:{x:1460,y:548},behind:{x:1460,y:532},boundary:{x:1460,y:548},front:{x:1460,y:549}},
79:{anchor:{x:1410,y:768},behind:{x:1325,y:752},boundary:{x:1325,y:768},front:{x:1325,y:784}},
80:{anchor:{x:1227,y:703},behind:{x:1215,y:687},boundary:{x:1215,y:703},front:{x:1215,y:719}},
81:{anchor:{x:1247,y:775},behind:{x:1247,y:759},boundary:{x:1247,y:775},front:{x:1247,y:791}},
82:{anchor:{x:1363,y:741},behind:{x:1357,y:725},boundary:{x:1357,y:741},front:{x:1357,y:757}},
83:{anchor:{x:496,y:759},behind:{x:509,y:743},boundary:{x:507,y:759},front:{x:507,y:775}},
84:{anchor:{x:218,y:852},behind:{x:412,y:836},boundary:{x:412,y:852},front:{x:412,y:864}}
})

export const RECALIBRATIONS = Object.freeze({
  49:{nineGridRegion:'southwest',homeChunk:'west-lower',reason:'Legacy declaration west_center disagrees with centroid; target owner is west-lower.'},
  54:{nineGridRegion:'center',homeChunk:'west-upper',reason:'Centroid crosses the nine-grid column while the accepted pillar owner remains west-upper.'},
  57:{nineGridRegion:'east_center',homeChunk:'east-upper',reason:'Centroid is in the middle row while the accepted pillar owner remains east-upper.'},
  74:{nineGridRegion:'southeast',homeChunk:'east-lower',reason:'Small polygon centroid lies southeast and maps to the east-lower worktable owner.'},
  76:{nineGridRegion:'southeast',homeChunk:'east-lower',reason:'Polygon centroid lies southeast and the accepted primary brace owner is east-lower.'},
  80:{nineGridRegion:'southeast',homeChunk:'east-upper',reason:'Centroid lies southeast, but accepted pillar-02 owner and top-level home chunk are east-upper.'},
  83:{nineGridRegion:'southwest',homeChunk:'west-lower',reason:'Polygon centroid lies southwest and maps to the west-lower brace owner.'}
})

export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }
export function stableJson(value) { return JSON.stringify(value, null, 2) }
export function onSegment(px,py,a,b,epsilon=1e-9){const cross=(px-a.x)*(b.y-a.y)-(py-a.y)*(b.x-a.x);if(Math.abs(cross)>epsilon)return false;return px>=Math.min(a.x,b.x)-epsilon&&px<=Math.max(a.x,b.x)+epsilon&&py>=Math.min(a.y,b.y)-epsilon&&py<=Math.max(a.y,b.y)+epsilon}
export function pointInPolygonInclusive(px,py,polygon){for(let i=0,j=polygon.length-1;i<polygon.length;j=i++)if(onSegment(px,py,polygon[j],polygon[i]))return true;let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.y>py)!==(b.y>py)&&px<(b.x-a.x)*(py-a.y)/(b.y-a.y)+a.x)inside=!inside}return inside}
export function countOwnedPixelsInPolygon(runs,polygon){let count=0;for(const [y,x0,x1] of runs)for(let x=x0;x<x1;x++)if(pointInPolygonInclusive(x+.5,y+.5,polygon))count++;return count}
export function pointStatus(point,inventory){const insideNav=point.x>=NAV_AREA.minX&&point.x<=NAV_AREA.maxX&&point.y>=NAV_AREA.minY&&point.y<=NAV_AREA.maxY;const collisionIds=inventory.collision.filter(o=>pointInPolygonInclusive(point.x,point.y,o.polygon)).map(o=>o.tmxId);const navObstacleIds=inventory.navObstacles.filter(o=>pointInPolygonInclusive(point.x,point.y,o.polygon)).map(o=>o.tmxId);return{insideNavArea:insideNav,collisionIds,navObstacleIds,navigable:insideNav&&collisionIds.length===0&&navObstacleIds.length===0}}
export function ownerPath(fragment){return fragment.ownershipRuns.map(([y,x0,x1])=>`M${x0} ${y}h${x1-x0}v1h-${x1-x0}z`).join('')}
export function xmlEscape(v){return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')}
