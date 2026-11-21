"""A glass cube (rounded like the picture's blocks) on a ground, under a sun: the ground's irradiance seen from above, rendered by a real light tracer (Mitsuba 3)."""
import sys, math
import numpy as np

def rounded_box_obj(path, hx, hy, hz, r, n=20):
    # a cube face grid projected onto a rounded box: inner box clamp + radius along the normal
    verts, faces = [], []
    def face(axis, sign):
        base = len(verts)
        u_axis, v_axis = [a for a in range(3) if a != axis]
        for i in range(n + 1):
            for j in range(n + 1):
                p = [0.0, 0.0, 0.0]
                h = [hx, hy, hz]
                p[axis] = sign * h[axis]
                # smooth spacing that concentrates points near the edges
                def t(k):
                    s = -1 + 2 * k / n
                    return math.copysign(abs(s) ** 1.6, s)
                p[u_axis] = t(i) * h[u_axis]
                p[v_axis] = t(j) * h[v_axis]
                inner = [max(-(h[a] - r), min(h[a] - r, p[a])) for a in range(3)]
                d = np.array(p) - np.array(inner)
                nrm = d / (np.linalg.norm(d) or 1)
                verts.append(np.array(inner) + nrm * r)
        for i in range(n):
            for j in range(n):
                a = base + i * (n + 1) + j
                b = a + 1
                c = a + (n + 1)
                dd = c + 1
                if (sign > 0) == (axis != 1):
                    faces.append((a, c, b)); faces.append((b, c, dd))
                else:
                    faces.append((a, b, c)); faces.append((b, dd, c))
    for axis in range(3):
        for sign in (-1, 1):
            face(axis, sign)
    with open(path, "w") as f:
        for v in verts:
            f.write("v %.6f %.6f %.6f\n" % tuple(v))
        for a, b, c in faces:
            f.write("f %d %d %d\n" % (a + 1, b + 1, c + 1))

if __name__ == "__main__":
    height = float(sys.argv[1]) if len(sys.argv) > 1 else 2.0
    rounded_box_obj("cube.obj", 0.46, height / 2, 0.46, min(0.16, height / 2.2))
    print("ok", height)
