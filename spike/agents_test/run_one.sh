#!/bin/zsh
S=/private/tmp/claude-501/-Users-mohamedsaeed-Desktop-Mo-inside-the-game-hackathon/b45f7483-8fab-4b6e-847f-8f6fe25a751f/scratchpad
c=$1; k=$2; r=$3; d=$S/runs/${c}_${k}_${r}
[ -f $d/verdict.json ] && exit 0
rm -rf $d; cp -R $S/cases/$c/$k $d; cd $d
claude -p "Read README.md in the current folder and do what it asks. Work only inside the current folder: do not read, list or search anything outside it, which would invalidate the test. Analyse the data with python3 and numpy by writing your own code. Use at most 25 tool calls. Finish by writing verdict.json in the current folder." --model sonnet --allowedTools "Bash(python3:*)" "Read" "Write" "Edit" --permission-mode acceptEdits --output-format json > _out.json 2> _err.txt
