export interface Page {
  /** 1-based physical page number in its PDF (not the printed page label). */
  pageNumber: number;
  text: string;
}
