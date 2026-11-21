"""One glass block with a rod of white light inside, the ground's light seen from above, averaged over the cube's eight symmetries: a template of what one block casts on the ground (Mitsuba 3)."""
import sys, math, time
import numpy as np
import mitsuba as mi
mi.set_variant("scalar_rgb")
from make_scene import rounded_box_obj

H = float(sys.argv[1]); Y0 = float(sys.argv[2]); spp = int(sys.argv[3]); res = int(sys.argv[4]) if len(sys.argv) > 4 else 256
EXT = 8.0                     # the ground seen: x, z in -EXT..EXT
name = "tpl_h%d_y%d" % (round(H * 100), round(Y0 * 100))
hy = H / 2
rounded_box_obj(name + ".obj", 0.46, hy, 0.46, min(0.16, H / 2.2), n=18)
yc = Y0 + hy
scene = mi.load_dict({
    "type": "scene",
    "integrator": {"type": "ptracer", "max_depth": 16},
    "sensor": {"type": "perspective", "fov": math.degrees(2 * math.atan(EXT / 900)), "fov_axis": "x",
               "to_world": mi.ScalarTransform4f().look_at(origin=[0, 900, 0], target=[0, 0, 0], up=[0, 0, 1]),
               "film": {"type": "hdrfilm", "width": res, "height": res, "rfilter": {"type": "gaussian"}, "pixel_format": "rgb"},
               "sampler": {"type": "independent", "sample_count": spp}},
    "ground": {"type": "rectangle", "to_world": mi.ScalarTransform4f().rotate([1, 0, 0], -90).scale(60), "bsdf": {"type": "diffuse", "reflectance": {"type": "rgb", "value": [1, 1, 1]}}},
    "cube": {"type": "obj", "filename": name + ".obj", "to_world": mi.ScalarTransform4f().translate([0, yc + 0.0005, 0]), "bsdf": {"type": "dielectric", "int_ior": 1.5, "ext_ior": 1.0}},
    "rod": {"type": "cube", "to_world": mi.ScalarTransform4f().translate([0, yc + 0.0005, 0]).scale([0.1, 0.4 * H, 0.1]), "emitter": {"type": "area", "radiance": {"type": "rgb", "value": [1, 1, 1]}}},
})
t = time.time()
a = np.array(mi.render(scene, spp=spp))[:, :, 0]
# fold the eight symmetries of a square (flips and the swap of the axes) into one average
sym = [a, a[::-1], a[:, ::-1], a[::-1, ::-1]]
sym += [s.T for s in sym]
m = sum(sym) / 8
c = res // 2
quad = m[c:, c:]                      # x >= 0, z >= 0 (the render's axes: image row / column)
np.save(name + ".npy", quad.astype(np.float32))
print(name, "%.0fs" % (time.time() - t), "max", quad.max())
