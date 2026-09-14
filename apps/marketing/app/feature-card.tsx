interface FeatureCardProps {
  icon: string; // SVG path data
  title: string;
  description: string;
  index: number;
}

export function FeatureCard({ icon, title, description, index }: FeatureCardProps) {
  return (
    <div
      className="fk-fade-in flex flex-col gap-3 rounded-2xl border border-border p-6 transition-colors duration-150 hover:border-foreground/20"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d={icon} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
