import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"


export const badgeVariants = cva(
  "inline-flex gap-1 items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary-hover",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-ui-accent",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow hover:opacity-90",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export type BadgeVariants = VariantProps<typeof badgeVariants>
