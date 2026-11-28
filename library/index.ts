import type { LibraryItem } from '../src/library.ts';
import { imagemagick } from './imagemagick/item.ts';
import { gimp } from './gimp/item.ts';

/** Every CLI of the library, in the order `ocli list` shows them. Add yours here (CONTRIBUTING.md). */
export const ITEMS: LibraryItem[] = [imagemagick, gimp];
