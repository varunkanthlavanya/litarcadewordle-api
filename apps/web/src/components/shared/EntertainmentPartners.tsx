/** Sponsor footer shown on every player-facing screen except the two
 * actual in-game screens (Timed Wordle / UNWORDLE play), where any extra
 * on-screen content competes with gameplay. Logos are served as static
 * assets from public/partners/ rather than imported, since they're pure
 * branding with no build-time processing needed. */
export function EntertainmentPartners() {
  return (
    <div className="mt-10 flex flex-col items-center gap-3 pb-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Entertainment Partner
      </p>
      <div className="flex flex-wrap items-center justify-center gap-6">
        <img
          src="/partners/vgp-wonder-ice-rink.png"
          alt="VGP Wonder Ice Rink"
          className="h-14 w-auto object-contain"
        />
        <img
          src="/partners/vgp-wonder-world.png"
          alt="VGP Wonder World"
          className="h-14 w-auto object-contain"
        />
      </div>
    </div>
  );
}
