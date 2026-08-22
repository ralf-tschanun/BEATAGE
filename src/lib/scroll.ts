/** Scroll to a section without a full page navigation. */
export function scrollToSection(id: string) {
  const run = () => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // Soft refresh can shift layout; scroll once now and again shortly after.
  requestAnimationFrame(run);
  window.setTimeout(run, 120);
}
