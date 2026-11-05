import type { TranscriptSegment } from '../../shared/types';
import { $, h, hms } from './dom';

export function segmentEl(s: TranscriptSegment): HTMLElement {
  const d = h('div', 'seg');
  d.append(h('span', 't', hms(s.startMs)), h('span', `who ${s.speaker}`, s.speaker === 'tutor' ? 'Tutor' : 'Student'), document.createTextNode(s.text));
  return d;
}

export class TranscriptView {
  private el = $('transcript');
  private stick = true;
  private empty = true;
  constructor() {
    this.el.addEventListener('scroll', () => {
      this.stick = this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight < 24;
    });
  }
  clear(): void {
    this.el.replaceChildren(h('div', 'empty', 'Transcript will appear here.'));
    this.empty = true; this.stick = true;
  }
  add(segs: TranscriptSegment[]): void {
    if (this.empty && segs.length) { this.el.replaceChildren(); this.empty = false; }
    for (const s of segs) this.el.append(segmentEl(s));
    if (this.stick) this.el.scrollTop = this.el.scrollHeight;
  }
}
