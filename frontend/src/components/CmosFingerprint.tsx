/**
 * Abstract stand-in for a CMOS sensor's PRNU impurity map — concentric,
 * hand-perturbed contours (not a real fingerprint algorithm) swept by a
 * single scanning line, evoking the enrollment capture in the product's
 * trust model. This is the one animated moment in the whole app.
 */
export function CmosFingerprint() {
  const rings = [
    "M100,20 C140,22 178,58 176,100 C174,142 138,178 98,176 C58,174 22,136 24,96 C26,58 60,18 100,20 Z",
    "M100,36 C132,38 162,66 160,100 C158,134 130,162 98,160 C66,158 38,128 40,96 C42,66 70,34 100,36 Z",
    "M100,52 C124,54 146,74 144,100 C142,126 122,146 98,144 C74,142 54,120 56,96 C58,74 78,50 100,52 Z",
    "M100,68 C116,70 130,82 128,100 C126,118 114,130 98,128 C82,126 68,112 70,96 C72,82 86,66 100,68 Z",
  ];

  return (
    <svg
      viewBox="0 0 200 200"
      width="100%"
      height="100%"
      role="img"
      aria-label="Simulated CMOS sensor fingerprint readout"
    >
      <defs>
        <clipPath id="fp-clip">
          <circle cx="100" cy="100" r="98" />
        </clipPath>
        <linearGradient id="fp-scan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c2793a" stopOpacity="0" />
          <stop offset="0.5" stopColor="#c2793a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#c2793a" stopOpacity="0" />
        </linearGradient>
      </defs>

      <circle
        cx="100"
        cy="100"
        r="98"
        fill="none"
        stroke="#2c3129"
        strokeWidth="1"
      />

      <g clipPath="url(#fp-clip)">
        {rings.map((d, i) => (
          <path
            key={d}
            d={d}
            fill="none"
            stroke="#4a5142"
            strokeOpacity={0.55 - i * 0.08}
            strokeWidth="1"
          />
        ))}
        <circle cx="100" cy="100" r="3.5" fill="#c2793a" />

        <rect x="0" y="-40" width="200" height="40" fill="url(#fp-scan)">
          <animate
            attributeName="y"
            values="-40;200;-40"
            dur="5s"
            repeatCount="indefinite"
          />
        </rect>
      </g>
    </svg>
  );
}
