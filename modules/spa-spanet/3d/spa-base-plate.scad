// Spa (jacuzzi) ESP32 - base plate for a Kradex Z74 IP65 enclosure (176.45 x 125.8 x 56.65 outer).
// Box geometry from the Kradex datasheet (Z74 - base): floor cavity ~164.55 x 113.9 (walls have draft),
// 4 lid bosses in the corners + 2 halfway the long walls, and 12 floor posts (d 6, 4.8 high, hole for a
// self-tapping screw). The plate rests on all 12 posts and is screwed to the 2 inner ones at x 128
// (the 2 at x 36 sit under a perfboard standoff): 2x self-tapping screw 2.9 x 6.5 mm (DIN 7981, pan head).
// v4 (default, use_plate = false): NO base plate. One standard 9 x 15 cm perfboard (uncut, 54 x 33 holes) is
// screwed straight onto the 4 inner floor posts (drill 4 holes of 3 mm, screws 2.9 x 6.5). use_plate = true
// keeps the older printed-plate version. The perfboard carries everything with everything on it: both RJ45 breakouts
// (A = patch cable from EXP1 in, B = patch cable to the health badge out, on nylon standoffs), ESP32 in female
// headers, Mini 560 step-down, resistors and sensor screw terminals - see fritzing/jacuzzi-gaatjesprint.png.
// The sensor cables (DS18B20 water 4 m, DS18B20 air 1 m, lid reed contact) are clamped by their M12 glands
// and go straight into the screw terminals at the right edge of the perfboard.
//
// Cable glands (TinyTronics):
//   -x wall: 2x M25 12-16 mm (hole 25 mm) for the two RJ45 patch cables - the RJ45 plug fits through
//            the open gland; wrap the thin cable with a few turns of self-amalgamating tape so it clamps.
//   +x wall: 3x M12 3-6.5 mm (hole 12 mm), one per sensor cable (3-5 mm) - these seal directly.
//
// part = "plate"     -> complete base plate (single colour)
// part = "yellow" + "labels" -> 2-colour print: plate with rims in colour 1, raised labels in colour 2.
//        The labels share layers with the rims, so the printer swaps colour in those 3 layers (with the
//        prime tower off the X1C flushes into the purge chute).
// part = "base" / "rims" / "labels" -> the three bodies for a multi-colour print: load all three STLs
//        as ONE object with several parts (Bambu/Orca/Prusa: "load as single object") and give each
//        part its own filament. Labels and rims both stand ON TOP of the plate (z > plate_t), so a
//        2-colour print needs only ONE filament change at z = plate_t and no prime tower.
// part = "drill_xmin" / "drill_xplus" -> flat drilling template for that wall: hold it flat against the
//        INSIDE of the wall, bottom edge on the box floor, and drill through the marked centres.
//
// show_parts = true  -> preview with ghost parts, cable glands and colour-coded wires (assembly view)
// show_parts = false -> only the printable plate (export this to STL)
//
// MEASURE BEFORE PRINTING: floor length/width of your box (inner_l / inner_w) and the real board sizes.
// All sizes in mm. Wire colours in the preview: red = +13 V, orange = 3.3 V, black = GND,
// blue = data spa->ESP (pin 5 / RX), green = data ESP->spa (pin 6 / TX), white = badge signal,
// yellow = DS18B20 data (4.7k pull-up to 3.3 V), violet = lid reed contact (GPIO19 <-> GND).

/* [View] */
show_parts = true;   // assembly preview (only with part = "plate")
part = "plate";      // "plate", "base", "rims", "labels", "drill_xmin", "drill_xplus"
two_colour = false;  // preview only: rims + labels in a second colour
label_d = 0.6;       // height of the raised labels (3 layers at 0.2 mm)

/* [Cable glands] */
m25_hole = 25;  m25_nut = 32;  m25_z = 22;  // D.3081 M25 (IP67 sheet): hole 25, key 32; z = centre above the inner floor
m25_nut_t = 5.42;                           // measured: nut thickness inside the box
m12_hole = 12;  m12_nut = 16;  m12_z = 19;  // D.3088 M12 (IP67 sheet): hole 12, thread 7.5, key 16/18, cable 3-6.5;  // high enough that the nut clears the plate

/* [Enclosure: Kradex Z74, origin = inner floor corner, x along the length] */
inner_l = 164.55;    // floor length (x)  - datasheet
inner_w = 113.9;     // floor width (y)   - datasheet (125.8 - 2 x 5.95), measure!
boss_r = 9;          // clearance radius around the 4 corner lid bosses
mid_notch = [17, 7]; // notch (length along the wall, depth) for the 2 lid bosses halfway the long walls
post_h = 4.8;        // floor posts: the plate rests on them
// the 12 floor posts (datasheet: 20.65 / 73.35 / 103.15 / 155.85 along the wall, 42.05 / 134.05 inner)
wall_posts = [for (x = [14.7, 67.4, 97.2, 149.9], y = [2.85, 111.05]) [x, y]];
inner_posts = [for (x = [36.1, 128.1], y = [16.8, 97.1]) [x, y]];
screw_posts = [for (y = [16.8, 97.1]) [128.1, y]];  // the posts at x 36.1 are under the perfboard standoffs
screw_d = 3.2;       // clearance hole for a 2.9 mm self-tapping screw
plate_x0 = 10;       // plate starts here: room for the M25 nuts on the -x wall

/* [Plate] */
plate_t = 2.4;
plate_margin = 0.8;  // gap between plate and box wall (long sides and +x)
fillet = 3;

/* [Pockets] */
lip_h = 4;           // height of the pocket walls
wall = 1.6;
clear = 0.4;         // play around each board
nub = 0.5;           // snap nub that holds the board down
gap_frac = 0.35;     // open part in the middle of each wall (wires, fingers)

/* [Board sizes: length x width x height] */
brk = [33, 24, 18];      // RJ45 breakout (jack on the -x short side)
esp = [51.5, 28.5, 13];  // ESP32 DevKit 30-pin (sits in female headers on the perfboard)
buck = [20.5, 15.5, 6];  // MINI560-PRO 5 A 3.3 V step-down (soldered on the perfboard)

/* [Perfboard: standard 9 x 15 cm double-sided, 54 x 33 holes, not cut] */
use_plate = false;       // false: perfboard straight on the Kradex floor posts (v4)
perf = [150, 90, 1.6];   // x (54 holes) by y (33 holes) - measure your board
perf_cols = 54;
perf_rows = 33;
brk_x = 25;              // RJ45 breakouts start 25 mm in: the plugs sit above the board
perf_hole_in = 2.5;      // mounting hole centre from the edges - measure
brk_standoff = 6;        // nylon M2.5 standoffs under the RJ45 breakouts
standoff_h = 6;          // room for the solder side (joints + wires)
standoff_d = 6.5;
standoff_pilot = 1.7;    // pilot hole for an M2 self-tapping screw (M2 x 6)

/* [Positions: lower-left corner of each board on the plate] */
pos_a = [33, 23];
pos_b = [33, 67];
pos_perf = [9, 12];      // lower-left corner of the perfboard: clears the M25 nuts (-x) and runs under the M12 nuts (+x)

/* [Sensor cables: strain relief zone near the +x wall] */
sens_y = [60, 78, 96];   // one cable + one M12 gland each: water probe, air probe, lid contact
// The shipped drill template STLs still carry the Dutch labels of an older version (LUCHT, DEKSEL, "wand",
// "onderrand = bodem"); re-export them from this file for the English labels.
sens_names = ["WATER", "AIR", "LID"];

$fn = 48;

// ------------------------------------------------------------------ plate

module rounded_rect(l, w, r) {
  offset(r) offset(-r) square([l, w]);
}

module plate_2d() {
  difference() {
    translate([plate_x0, plate_margin])
      rounded_rect(inner_l - plate_x0 - plate_margin, inner_w - 2 * plate_margin, fillet);
    // corner lid bosses and the two bosses halfway the long walls
    for (x = [0, inner_l], y = [0, inner_w]) translate([x, y]) circle(r = boss_r);
    for (y = [0, inner_w - mid_notch[1]]) translate([inner_l / 2 - mid_notch[0] / 2, y]) rounded_rect(mid_notch[0], mid_notch[1], 1);
    // screw holes on the 4 inner floor posts
    for (c = screw_posts) translate(c) circle(d = screw_d);
  }
}

module pocket(size, open_sides = [true, true, true, true]) {
  l = size[0] + 2 * clear;
  w = size[1] + 2 * clear;
  translate([-clear - wall, -clear - wall, plate_t])
    difference() {
      cube([l + 2 * wall, w + 2 * wall, lip_h]);
      translate([wall, wall, -1]) cube([l, w, lip_h + 2]);
      // openings in the middle of each wall
      g_l = l * gap_frac;
      g_w = w * gap_frac;
      if (open_sides[0]) translate([wall + (l - g_l) / 2, -1, -1]) cube([g_l, wall + 2, lip_h + 2]);
      if (open_sides[1]) translate([wall + (l - g_l) / 2, w + wall - 1, -1]) cube([g_l, wall + 2, lip_h + 2]);
      if (open_sides[2]) translate([-1, wall + (w - g_w) / 2, -1]) cube([wall + 2, g_w, lip_h + 2]);
      if (open_sides[3]) translate([l + wall - 1, wall + (w - g_w) / 2, -1]) cube([wall + 2, g_w, lip_h + 2]);
    }
  // snap nubs on the long walls
  for (x = [l * 0.2, l * 0.8]) {
    translate([x - clear, -clear, plate_t + lip_h - 0.8]) rotate([0, 90, 0]) cylinder(r = nub, h = 3, center = true);
    translate([x - clear, w - clear, plate_t + lip_h - 0.8]) rotate([0, 90, 0]) cylinder(r = nub, h = 3, center = true);
  }
}

module zip_slot(x, y, rot = 0) {
  translate([x, y, -1]) rotate([0, 0, rot]) translate([-1.5, -2.5]) cube([3, 5, plate_t + 2]);
}

module label(txt, x, y, size = 4, rot = 0) {  // 2D
  translate([x, y]) rotate([0, 0, rot])
    text(txt, size = size, font = "Liberation Sans:style=Bold", halign = "center", valign = "center");
}

module labels_2d() {
  label("CABLES", plate_x0 + 5, inner_w / 2, 4, 90);
  label("SENSORS", inner_l - 5.5, sens_y[1], 3.5, 90);
}

// Zip ties: every tie needs a PAIR of slots (down through one, up through the other, around the bundle).
// Only the sensor cables need strain relief (one tie each at the +x wall): all other wiring is on the perfboard.
module tie_pair(x, y, vertical_bundle) {  // slots 8 mm apart, straddling a bundle at (x, y)
  if (vertical_bundle) { zip_slot(x - 4, y); zip_slot(x + 4, y); }
  else { zip_slot(x, y - 4, 90); zip_slot(x, y + 4, 90); }
}

module zip_slots() {}  // none needed any more: the glands clamp the sensor cables

module labels_body() {  // raised on top of the plate, only where there is plate underneath
  difference() {
    translate([0, 0, plate_t]) linear_extrude(label_d) intersection() { plate_2d(); labels_2d(); }
    rims_body();
  }
}

module base_body() {
  difference() {
    linear_extrude(plate_t) plate_2d();
    zip_slots();
  }
}

module rims_body() {  // board pockets + snap nubs, standing on the plate
  difference() {
    union() {
      standoffs();
    }
    zip_slots();
  }
}

module plate() { base_body(); rims_body(); labels_body(); }

function perf_mount() = [for (x = [perf_hole_in, perf[0] - perf_hole_in], y = [perf_hole_in, perf[1] - perf_hole_in]) pos_perf + [x, y]];

module standoffs() {  // 4 posts for the perfboard, M2 self-tapping screw from the top
  for (c = perf_mount()) translate([c[0], c[1], plate_t]) difference() {
    cylinder(d = standoff_d, h = standoff_h);
    translate([0, 0, 1]) cylinder(d = standoff_pilot, h = standoff_h);
  }
}

// ------------------------------------------------------------------ assembly preview

function term(p, i) = [p[0] + brk[0] - 2, p[1] + 2 + (i - 0.5) * (brk[1] - 4) / 8, plate_t + 8];  // screw terminal pin i
// perfboard hole (col 0..23 along x = A..X, row 0..29 along y = 1..30), on top of the board
perf_z0 = use_plate ? plate_t + standoff_h : 0;  // bottom of the perfboard (0 = on the floor posts)
perf_top = perf_z0 + perf[2];
function hole(c, r, dz = 0) = [pos_perf[0] + (perf[0] - (perf_cols - 1) * 2.54) / 2 + c * 2.54, pos_perf[1] + (perf[1] - (perf_rows - 1) * 2.54) / 2 + r * 2.54, perf_top + dz];

module gland(x, y, z, nut) {  // cap + nut across the wall (x = inner face)
  color("lightgray") translate([x, y, z]) rotate([0, 90, 0]) cylinder(d = nut, h = 8, $fn = 6);
}

module wire(pts, c, d = 1.4) {
  color(c) for (i = [0 : len(pts) - 2]) hull() {
    translate(pts[i]) sphere(d = d, $fn = 12);
    translate(pts[i + 1]) sphere(d = d, $fn = 12);
  }
}

module resistor(a, b) {
  m = (a + b) / 2;
  v = b - a;
  color("tan") translate(m) rotate([0, 0, atan2(v[1], v[0])]) rotate([0, 90, 0]) cylinder(d = 2.3, h = 6.5, center = true);
}

module ghost(p, size, c, z = 0) {
  color(c, 0.55) translate([p[0], p[1], plate_t + z]) cube(size);
}

module kf301(c, r0, n) {  // 5.08 mm screw terminal block, pins in column c from row r0 every 2 rows
  p = hole(c, r0);
  color("dodgerblue", 0.85) translate([p[0] - 3.8, p[1] - 2.54, perf_top]) cube([7.6, n * 5.08, 10]);
}

module parts() {
  // perfboard - layout as in fritzing/jacuzzi-gaatjesprint.png (columns A..AP = index 0..41, ESP32 block from S = 18)
  color("darkgreen", 0.9) translate([pos_perf[0], pos_perf[1], perf_z0]) difference() {
    cube(perf);
    for (c = use_plate ? perf_mount() : inner_posts) translate([c[0] - pos_perf[0], c[1] - pos_perf[1], -1]) cylinder(d = 3, h = 4);
  }
  for (c = use_plate ? perf_mount() : inner_posts) color("silver") translate([c[0], c[1], perf_top]) cylinder(d = use_plate ? 3.8 : 5.5, h = 1.8);
  // RJ45 breakouts A (spa, in) and B (logo, out) on nylon standoffs, jack flush with the left board edge
  for (yc = [pos_a[1] + 12, pos_b[1] + 12]) {
    z = perf_top + brk_standoff;
    for (dy = [-brk[1] / 2 + 3, brk[1] / 2 - 3]) color("white") translate([pos_perf[0] + brk_x + 19, yc + dy, perf_top]) cylinder(d = 4.5, h = brk_standoff, $fn = 6);
    color("seagreen", 0.9) translate([pos_perf[0] + brk_x, yc - brk[1] / 2, z]) cube([brk[0], brk[1], 1.6]);
    color("silver") translate([pos_perf[0] + brk_x - 1.5, yc - 8, z + 1.6]) cube([17, 16, 13.5]);
    color("limegreen") translate([pos_perf[0] + brk_x + brk[0] - 5, yc - 11, z + 1.6]) cube([5, 22, 8]);
  }
  // ESP32 in female headers (USB towards -y, blocked by the Mini 560)
  color("black") for (c = [34, 44]) translate(hole(c, 14) - [1.27, 1.27, 0]) cube([2.54, 15 * 2.54, 8.5]);
  e0 = hole(39, 21, 8.5);
  color("royalblue", 0.8) translate([e0[0] - esp[1] / 2, e0[1] - esp[0] / 2 - 2, e0[2]]) cube([esp[1], esp[0], 1.6]);
  color("silver") translate([e0[0] - 5, e0[1] - esp[0] / 2 + 1, e0[2] - 3]) cube([10, 7, 3]);  // USB
  color("purple", 0.8) translate(hole(29, 1, 3) - [1, 1, 0]) cube([buck[0], buck[1], 3]);
  kf301(50, 14, 3); // J3 water: GND, DATA, 3V3
  kf301(50, 21, 3); // J4 air:   GND, DATA, 3V3
  kf301(50, 28, 2); // J5 lid:   GND, SIG
  resistor(hole(28, 9, 1.5), hole(32, 9, 1.5));
  resistor(hole(28, 11, 1.5), hole(32, 11, 1.5));
  resistor(hole(47, 16, 1.5), hole(47, 20, 1.5));
  resistor(hole(47, 23, 1.5), hole(47, 27, 1.5));
  // cable glands and patch cables through the -x wall, straight into the jacks
  for (y = [pos_a[1] + 12, pos_b[1] + 12]) {
    gland(-4, y, m25_z - post_h, m25_nut);
    jack_z = perf_top + brk_standoff + 1.6 + 6;
    color("white") hull() {
      translate([-12, y, m25_z - post_h]) rotate([0, 90, 0]) cylinder(d = 6, h = 1);
      translate([pos_perf[0] + brk_x - 22, y, jack_z]) rotate([0, 90, 0]) cylinder(d = 6, h = 1);
    }
    color("violet", 0.7) translate([pos_perf[0] + brk_x - 22, y - 6, jack_z - 6]) cube([21, 12, 12]);  // RJ45 plug
  }
  // sensor cables: clamped by one M12 gland each in the +x wall, straight into J3 / J4 / J5
  for (y = sens_y) gland(inner_l - 4, y, m12_z - post_h, m12_nut);
  sens_row = [16, 23, 30];
  for (i = [0 : 2]) color("dimgray") hull() {
    translate([inner_l + 8, sens_y[i], m12_z - post_h]) sphere(d = 4, $fn = 12);
    translate(hole(50, sens_row[i], 5) + [4, 0, 0]) sphere(d = 3.5, $fn = 12);
  }
  // plate version only: 2 screws into the inner floor posts at x 128 (under the perfboard)
  if (use_plate) for (c = screw_posts) color("silver") translate([c[0], c[1], plate_t]) cylinder(d = 5.5, h = 1.8);
}

module box() {  // Kradex Z74 base, simplified, floor at z = 0
  %translate([-2.5, -2.5, -2.5]) difference() {
    cube([inner_l + 5, inner_w + 5, 38.4]);
    translate([2.5, 2.5, 2.5]) cube([inner_l, inner_w, 40]);
  }
  color("gainsboro", 0.7) {
    for (x = [0, inner_l], y = [0, inner_w]) translate([x, y, 0]) cylinder(r = boss_r - 1.5, h = 36);
    for (y = [0, inner_w]) translate([inner_l / 2, y, 0]) cylinder(d = 12, h = 36);
    for (c = concat(wall_posts, inner_posts)) translate([c[0], c[1], 0]) cylinder(d = 6, h = post_h);
  }
}

// ------------------------------------------------------------------ drilling templates

module drill_template(holes) {  // holes = [[y, z, d], ...] in box coordinates (inner face)
  h = 45;
  difference() {
    rounded_rect(inner_w, h, 2);
    for (y = [0, inner_w]) translate([y, 0]) circle(r = boss_r);  // corner lid bosses
    for (c = holes) translate([c[0], c[1]]) {
      circle(d = 3.2);                                                  // pilot hole
      difference() { circle(d = c[2]); circle(d = c[2] - 1.2); }        // outline of the final hole
    }
  }
}

module drill_label(txt, y, z) {
  translate([y, z]) text(txt, size = 3, font = "Liberation Sans:style=Bold", halign = "center", valign = "center");
}

if (part == "plate") {
  translate([0, 0, show_parts ? post_h : 0]) {
    if (use_plate || !show_parts) {
      color("gold") { base_body(); rims_body(); }
      color(two_colour ? "black" : "gold") labels_body();
    }
    if (show_parts) parts();
  }
  if (show_parts) box();
} else if (part == "yellow") {
  base_body(); rims_body();
} else if (part == "base") {
  base_body();
} else if (part == "rims") {
  rims_body();
} else if (part == "labels") {
  labels_body();
} else if (part == "drill_xmin") {
  // seen from INSIDE, facing the -x wall: +y runs to the right, template as drawn
  linear_extrude(1.2) difference() {
    drill_template([for (y = [pos_a[1] + 12, pos_b[1] + 12]) [y, m25_z, m25_hole]]);
    for (y = [pos_a[1] + 12, pos_b[1] + 12]) drill_label("M25", y, m25_z + m25_hole / 2 + 4);
    drill_label("-x wall (EXP1/LOGO) - bottom edge = floor", inner_w / 2, 3);
  }
} else if (part == "drill_xplus") {
  // seen from INSIDE, facing the +x wall: +y runs to the left, so positions are mirrored (text is not)
  linear_extrude(1.2) difference() {
    drill_template([for (y = sens_y) [inner_w - y, m12_z, m12_hole]]);
    for (i = [0 : 2]) drill_label(sens_names[i], inner_w - sens_y[i], m12_z + m12_hole / 2 + 4);
    drill_label("+x wall (SENSORS) - bottom edge = floor", inner_w / 2, 3);
  }
}
