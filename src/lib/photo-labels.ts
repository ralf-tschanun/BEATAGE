/** Display label for photo contest candidates: "Photo 3 - beach.jpg". */
export function formatPhotoLabel(photoNumber: number, title: string): string {
  const name = title.trim() || "Untitled";
  return `Photo ${photoNumber} - ${name}`;
}

/** Assign 1…n by list order (same order as the sorted candidate list). */
export function photoNumberByCandidateId(
  candidates: Array<{ id: string }>,
): Record<string, number> {
  const map: Record<string, number> = {};
  candidates.forEach((candidate, index) => {
    map[candidate.id] = index + 1;
  });
  return map;
}
