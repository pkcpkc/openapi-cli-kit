import type { LibraryItem } from '../src/library.ts';
import { magick } from './magick/item.ts';

/** Every CLI of the library, in the order `ocli list` shows them. Add yours here (CONTRIBUTING.md). */
export const ITEMS: LibraryItem[] = [magick];
