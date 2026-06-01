import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";

const button = cva("hms-btn", {
  variants: {
    size: {
      sm: "hms-btn-sm",
      md: "hms-btn-md",
      lg: "hms-btn-lg",
    },
    variant: {
      default: "",
      primary: "hms-btn-primary",
      danger:  "hms-btn-danger",
    },
  },
  defaultVariants: { size: "md", variant: "default" },
});

type ButtonVariants = VariantProps<typeof button>;

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    ButtonVariants {}

/**
 * Thin wrapper around <button> that applies the project's `.hms-btn-*` utility
 * classes for consistent sizing and intent styling.
 *
 * All standard HTMLButtonElement props (onClick, disabled, type, style, …) are
 * forwarded. Use `className` to add one-off overrides.
 *
 * @example
 *   <Button size="sm" variant="danger" onClick={handleDelete}>
 *     <Trash2 size={12} /> Delete
 *   </Button>
 */
export default function Button({
  size,
  variant,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button className={button({ size, variant, className })} {...rest}>
      {children}
    </button>
  );
}

