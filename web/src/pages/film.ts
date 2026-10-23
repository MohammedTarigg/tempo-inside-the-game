import { startMatch } from '../match/view.ts';
import { runFilm } from '../film/film.ts';
import { start } from './start.ts';

start(async () => runFilm(await startMatch('film')));
