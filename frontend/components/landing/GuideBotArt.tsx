import type { ReactNode, SVGProps } from 'react'

// The buyer robot from BuyerAgent.tsx without its eyes and mouth (same artwork, ids renamed so it can
// share a page with the other robots). The guide draws its own face into `face`, so it can change expression.
export function GuideBotArt({ face, ...props }: SVGProps<SVGSVGElement> & { face: ReactNode }) {
  return (
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 560" fill="none" {...props}>
  <defs>
    <linearGradient id="guide-shell-gradient" x1="135" y1="110" x2="470" y2="455" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#FFFFFF"></stop>
      <stop offset="0.55" stopColor="#F3F5F8"></stop>
      <stop offset="1" stopColor="#D9DFE8"></stop>
    </linearGradient>
    <linearGradient id="guide-shell-side-gradient" x1="170" y1="150" x2="310" y2="430" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#F9FAFC"></stop>
      <stop offset="0.7" stopColor="#E7EAF0"></stop>
      <stop offset="1" stopColor="#CBD2DC"></stop>
    </linearGradient>
    <linearGradient id="guide-shell-highlight" x1="170" y1="115" x2="330" y2="260" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95"></stop>
      <stop offset="1" stopColor="#FFFFFF" stopOpacity="0"></stop>
    </linearGradient>
    <linearGradient id="guide-face-gradient" x1="315" y1="185" x2="500" y2="350" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#273145"></stop>
      <stop offset="0.48" stopColor="#171E30"></stop>
      <stop offset="1" stopColor="#0B111F"></stop>
    </linearGradient>
    <linearGradient id="guide-guide-accent" x1="330" y1="220" x2="455" y2="320" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#667DDE"></stop>
      <stop offset="1" stopColor="#4056B8"></stop>
    </linearGradient>
    <radialGradient id="guide-antenna-gradient" cx="32%" cy="28%" r="76%">
      <stop offset="0" stopColor="#8296F0"></stop>
      <stop offset="0.5" stopColor="#566BD0"></stop>
      <stop offset="1" stopColor="#34468F"></stop>
    </radialGradient>
    <linearGradient id="guide-visor-edge" x1="315" y1="185" x2="485" y2="355" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#3B465D"></stop>
      <stop offset="1" stopColor="#111827"></stop>
    </linearGradient>
    <filter id="guide-floating-depth" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="7"></feGaussianBlur>
    </filter>
  </defs>
  <g id="guide-agent-character">
    <g id="guide-antenna" style={{ filter: 'drop-shadow(0 0 9px rgba(79,124,255,.55))' }}>
      <path d="M347 133
           C350 118 355 103 364 91
           C369 84 376 83 382 87
           C387 91 388 98 385 105
           L376 136
           Z" fill="#30394C"></path>
      <path d="M363 111
           C366 99 371 91 377 87
           C379 86 381 87 382 89
           C376 99 373 111 372 123" stroke="#68738A" strokeWidth="5" strokeLinecap="round" opacity="0.42"></path>
      <circle cx="375" cy="69" r="33" fill="#182238"></circle>
      <circle cx="375" cy="69" r="28" fill="url(#guide-antenna-gradient)"></circle>
      <ellipse cx="365" cy="58" rx="10" ry="8" fill="#FFFFFF" opacity="0.46"></ellipse>
      <circle cx="375" cy="69" r="21" stroke="#7183DD" strokeWidth="2" opacity="0.42"></circle>
    </g>
    <g id="guide-body">
      <ellipse cx="318" cy="476" rx="137" ry="14" fill="#182133" opacity="0.09" filter="url(#guide-floating-depth)"></ellipse>
      <ellipse cx="306" cy="292" rx="183" ry="174" fill="url(#guide-shell-gradient)"></ellipse>
      <path d="M157 161
           C107 198 91 249 94 306
           C98 383 153 439 224 459
           C264 470 303 466 337 453
           C279 429 241 388 226 335
           C210 279 219 216 250 171
           C220 161 188 154 157 161
           Z" fill="url(#guide-shell-side-gradient)" opacity="0.9"></path>
      <path d="M157 169
           C119 207 106 258 110 310
           C115 369 150 415 203 440" stroke="#C7CED9" strokeWidth="5" strokeLinecap="round" opacity="0.68"></path>
      <path d="M122 320
           C139 398 207 454 291 462
           C329 465 365 456 395 438
           C358 457 315 461 277 451
           C199 431 143 383 122 320
           Z" fill="#C9D0DA" opacity="0.27"></path>
      <ellipse cx="243" cy="165" rx="128" ry="69" fill="url(#guide-shell-highlight)"></ellipse>
      <path d="M238 153
           C208 185 193 226 192 270
           C191 315 204 356 228 390" stroke="#D0D6DF" strokeWidth="4" strokeLinecap="round" opacity="0.55"></path>
      <ellipse cx="318" cy="449" rx="50" ry="17" fill="#20293B" opacity="0.86"></ellipse>
      <ellipse cx="318" cy="445" rx="38" ry="9" fill="#111827"></ellipse>
      <ellipse cx="318" cy="444" rx="27" ry="5" fill="#5267C9" opacity="0.58"></ellipse>
    </g>
    <g id="guide-head-shell">
      <path d="M143 242
           C143 190 173 150 219 129
           C254 113 290 111 326 119
           C287 142 263 177 253 219
           C244 257 247 300 260 337
           C271 368 289 393 313 411
           C267 410 222 394 190 365
           C159 337 142 295 143 242
           Z" fill="url(#guide-shell-gradient)"></path>
      <path d="M174 181
           C195 151 226 133 258 126" stroke="#FFFFFF" strokeWidth="8" strokeLinecap="round" opacity="0.72"></path>
      <path d="M326 119
           C292 140 270 174 260 214
           C250 256 253 300 268 337
           C280 366 297 391 322 408" stroke="#C9D0DB" strokeWidth="5" strokeLinecap="round" opacity="0.8"></path>
      <path d="M213 149
           C245 127 280 117 318 120
           C339 122 358 128 376 138" stroke="#D1D7E0" strokeWidth="4" strokeLinecap="round" opacity="0.62"></path>
      <path d="M324 128
           C367 126 407 143 435 171
           C459 196 471 229 473 265
           C474 305 461 339 437 363
           C416 384 388 397 357 401
           C337 384 322 362 312 337
           C298 301 294 259 302 222
           C309 185 317 151 324 128
           Z" fill="url(#guide-shell-gradient)"></path>
      <path d="M377 139
           C418 153 447 182 460 218" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" opacity="0.48"></path>
    </g>
    <g id="guide-face-panel">
      <path d="M322 205
           C329 184 343 169 362 163
           C383 157 411 163 431 176
           C454 191 468 215 472 243
           C477 271 474 302 465 326
           C456 350 441 366 422 374
           C402 383 378 381 359 369
           C343 359 330 341 322 319
           C314 296 311 266 314 241
           C315 226 318 214 322 205
           Z" fill="#0C1322"></path>
      <path d="M329 211
           C336 192 349 179 365 174
           C384 168 407 173 425 185
           C446 199 459 220 463 245
           C467 271 465 297 457 319
           C449 341 436 354 420 362
           C402 371 381 368 365 359
           C350 350 340 335 332 316
           C325 296 323 270 325 246
           C326 232 327 220 329 211
           Z" fill="url(#guide-face-gradient)"></path>
      <path d="M425 184
           C448 201 461 222 465 247
           C469 272 466 299 458 320
           C450 340 437 353 420 362" stroke="url(#guide-visor-edge)" strokeWidth="5" strokeLinecap="round" opacity="0.9"></path>
      <path d="M329 212
           C323 238 321 269 325 295
           C328 318 337 338 350 351" stroke="#364157" strokeWidth="3" strokeLinecap="round" opacity="0.5"></path>
      <path d="M350 194
           C369 179 397 179 418 190" stroke="#66738A" strokeWidth="5" strokeLinecap="round" opacity="0.18"></path>
      <path d="M345 346
           C366 365 399 370 425 355" stroke="#3C465A" strokeWidth="2" strokeLinecap="round" opacity="0.5"></path>
    </g>
    <g id="guide-face">
      <path d="M338 216
           C344 194 360 181 378 177
           C359 209 350 247 352 285
           C354 318 364 344 380 361
           C360 357 345 344 336 325
           C327 302 324 273 327 247
           C329 235 332 224 338 216
           Z" fill="#4B566B" opacity="0.10"></path>
      <path d="M431 207
           C445 225 451 248 451 269" stroke="#8793A8" strokeWidth="3" strokeLinecap="round" opacity="0.12"></path>
    </g>
    {face}
  </g>
</svg>
  )
}
