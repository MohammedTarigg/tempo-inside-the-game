#!/bin/zsh
# One blind run on a sustained-cause case from the simpler simulator in sustained_sim/.
#   experiments/agents/run_sustained.sh <work> <case> <run>
set -eu
W=$1 c=$2 r=$3
d=$W/runs_sustained/${c}_${r}
[ -f $d/verdict.json ] && exit 0
rm -rf $d; mkdir -p $W/runs_sustained; cp -R $W/sustained_cases/$c $d; cd $d
claude -p "Read README.md in the current folder and do what it asks. Work only inside the current folder: do not read, list or search anything outside it, which would invalidate the test. Analyse the data with python3 by writing your own code. Use at most 25 tool calls. Finish by writing verdict.json in the current folder." --model sonnet --allowedTools "Bash(python3:*)" "Read" "Write" "Edit" --permission-mode acceptEdits --output-format json > _out.json 2> _err.txt
