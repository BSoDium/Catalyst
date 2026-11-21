#!/bin/sh
for h in 0.5 1.3 2.4; do for y in 0 0.9 1.8 2.7; do ./.venv/bin/python render_template.py $h $y 4000 256 2>&1 | tail -1; done; done
echo ALL-DONE
