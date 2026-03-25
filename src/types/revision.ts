export type RevisionKind = 'insertion' | 'deletion';

export interface Revision {
  id: string;
  chapter: string;
  kind: RevisionKind;
  author: string;
  date: Date;
  text: string;
  precedingContext: string;
  decided: boolean | null;
}
