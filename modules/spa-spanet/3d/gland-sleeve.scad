// Split seal sleeve for the M25 cable glands (D.3081) around a thin RJ45 patch cable.
// Replaces the gland's own rubber insert (made for 12-18 mm cable). Print in a flexible filament
// (e.g. Fiberflex 40D): the helical slit lets you clip it around a cable that already has its plugs;
// tightening the gland cap squeezes the slit shut and clamps the cable.
//
// MEASURE: the original rubber insert (outer diameter + length) and your patch cable (diameter).
// Fitting: cap over the plug onto the cable, plug through the gland body into the box, clip the
// sleeve around the cable, push it into the gland body (cone towards the cap), tighten the cap.

/* [Measure these] */
seal_od = 18.7;   // measured: outer diameter of the original rubber insert (18.72)
seal_len = 10.5;  // original insert is 8.5, +2 mm: the first print left a 2 mm gap below the claws
cable_d = 5.47;   // measured: patch cable diameter

/* [Fit] */
squeeze = -0.5;   // bore 0.5 mm LARGER than the cable: the claws squeeze the cone (and the slit) shut onto the cable
slit = 0.5;       // printed slit width (closes when the cap is tightened)
slit_twist = 60;  // helical slit (degrees over the length): seals better than a straight cut
cone_h = 7;       // top part that the gland's claws squeeze: cone from seal_od down to cone_top_d
cone_top_d = 14;  // the claws close to 10.38 mm: ~1.8 mm squeeze per side
grip_ribs = 2;    // small inner ribs for extra grip on the cable (0 = smooth bore)

$fn = 96;

module sleeve() {
  difference() {
    // body with a cone at the top (cap side)
    rotate_extrude() polygon([
      [0, 0], [seal_od / 2, 0], [seal_od / 2, seal_len - cone_h],
      [cone_top_d / 2, seal_len], [0, seal_len]
    ]);
    // bore with small grip ribs
    translate([0, 0, -1]) cylinder(d = cable_d - squeeze, h = seal_len + 2);
    // helical slit from the bore to the outside, over the full length
    translate([0, 0, -0.5]) linear_extrude(height = seal_len + 1, twist = slit_twist, slices = 40)
      translate([0, -slit / 2]) square([seal_od, slit]);
  }
  // grip ribs inside the bore (thin rings, they deform around the cable)
  if (grip_ribs > 0)
    for (i = [1 : grip_ribs]) {
      z = i * seal_len / (grip_ribs + 1);
      difference() {
        translate([0, 0, z - 0.4]) cylinder(d = cable_d - squeeze + 0.1, h = 0.8);
        translate([0, 0, z - 1]) cylinder(d = cable_d - squeeze - 0.8, h = 2);
        translate([0, 0, z - 1]) linear_extrude(height = 2)  // keep the slit open through the rib
          rotate([0, 0, -slit_twist * z / seal_len]) translate([0, -slit / 2]) square([seal_od, slit]);
      }
    }
}

sleeve();
