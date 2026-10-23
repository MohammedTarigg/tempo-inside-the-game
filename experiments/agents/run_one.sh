#!/bin/zsh
# One blind investigator run: copies case <case>/<kind> into <work>/runs/<case>_<kind>_<run> and asks a headless Claude
# Code session to answer its README there, with no sight of anything outside the folder.
#   experiments/agents/run_one.sh <work> <case> <raw|inst> <run>
set -eu
W=$1 c=$2 k=$3 r=$4
d=$W/runs/${c}_${k}_${r}
[ -f $d/verdict.json ] && exit 0
rm -rf $d; mkdir -p $W/runs; cp -R $W/cases/$c/$k $d; cd $d
claude -p "Read README.md in the current folder and do what it asks. Work only inside the current folder: do not read, list or search anything outside it, which would invalidate the test. Analyse the data with python3 and numpy by writing your own code. Use at most 25 tool calls. Finish by writing verdict.json in the current folder." --model sonnet --allowedTools "Bash(python3:*)" "Read" "Write" "Edit" --permission-mode acceptEdits --output-format json > _out.json 2> _err.txt
