export default function HermesMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="none"
      width={size}
      height={size}
      className="hms-mark"
      aria-hidden="true"
    >
      <text
        x="16"
        y="25"
        fontSize="26"
        textAnchor="middle"
        fill="currentColor"
        fontFamily="serif"
      >
        ☤
      </text>
    </svg>
  );
}