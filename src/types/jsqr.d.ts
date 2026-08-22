declare module "jsqr" {
  export type Point = { x: number; y: number };

  export type QRCode = {
    data: string;
    location: {
      topLeftCorner: Point;
      topRightCorner: Point;
      bottomLeftCorner: Point;
      bottomRightCorner: Point;
    };
  };

  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" },
  ): QRCode | null;
}
