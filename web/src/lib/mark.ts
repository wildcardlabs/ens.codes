/**
 * The site's mark: a tilted ticket with one eye open and one winking. One closed outline, to be
 * filled with the even-odd rule so the eyes and the side bites are real holes and show whatever is
 * behind the mark. The header, the on-page tickets and the ticket image all draw it.
 *
 * It is drawn in a 200 x 200 box and fills only the middle of it; `MARK_BOX` is the part it occupies,
 * so a mark sized by that box has no empty margin around it. This is the small-size cut of the
 * artwork in brand/: the same ticket with slightly heavier eyes, which hold up at header size.
 */
export const MARK_PATH =
  'M47.51 49.82L136.63 37.29A31 31 0 0 1 171.64 63.68L172.82 72.09A17.5 17.5 0 0 0 177.7 106.75L178.88 115.17A31 31 0 0 1 152.49 150.18L63.37 162.71A31 31 0 0 1 28.36 136.32L27.18 127.91A17.5 17.5 0 0 0 22.3 93.25L21.12 84.83A31 31 0 0 1 47.51 49.82ZM76.4 90.19 A12.5 12.5 -8 1 0 79.88 114.95 A12.5 12.5 -8 1 0 76.4 90.19ZM139.94 95.12A20.22 20.22 0 0 0 103.83 100.2A5.25 5.25 0 0 0 113.84 103.38A9.72 9.72 0 0 1 131.2 100.94A5.25 5.25 0 0 0 139.94 95.12Z'

/** The mark's own bounds inside the 200-unit drawing: x, y, width, height. */
export const MARK_BOX = { x: 15, y: 31, width: 170, height: 138 } as const
