import { cn } from "@/lib/utils";

interface PresenceDotProps {
  online: boolean;
  label?: string;
  className?: string;
}

export function PresenceDot({ online, label, className }: PresenceDotProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <span
        className={cn(
          "h-[7px] w-[7px] rounded-full",
          online ? "bg-success animate-presence-pulse" : "bg-offline"
        )}
      />
      {label ? <span className={online ? "text-success" : "text-offline"}>{label}</span> : null}
    </span>
  );
}
