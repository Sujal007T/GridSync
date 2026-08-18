const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = 62;

export class PositionKey {
  /**
   * Generates a position key between left and right.
   * Left and right can be empty strings (indicating boundaries).
   */
  public static generate(left: string | null = "", right: string | null = ""): string {
    const l = left || "";
    const r = right || "";
    const mid = this.midpoint(l, r);
    // Append a random tiebreak character to minimize identical position keys from concurrent inserts
    return mid + DIGITS.charAt(Math.floor(Math.random() * BASE));
  }

  /**
   * Calculates the exact lexicographical midpoint between two base-62 strings.
   */
  public static midpoint(left: string, right: string): string {
    if (left !== "" && right !== "" && left >= right) {
      throw new Error(`left (${left}) must be less than right (${right})`);
    }

    let mid = "";
    let i = 0;

    while (true) {
      const leftChar = i < left.length ? DIGITS.indexOf(left.charAt(i)) : 0;
      const rightChar = i < right.length ? DIGITS.indexOf(right.charAt(i)) : BASE;

      if (i === 0 && left === "" && right === "") {
        // Between start and end
        return DIGITS.charAt(Math.floor(BASE / 2));
      }
      if (i === 0 && left === "") {
        // Between start and right
        if (rightChar > 1) {
          return DIGITS.charAt(Math.floor(rightChar / 2));
        } else {
          mid += DIGITS.charAt(0);
          i++;
          continue;
        }
      }
      if (i === 0 && right === "") {
        // Between left and end
        if (leftChar < BASE - 2) { // Need room to go up
          return left.substring(0, i) + DIGITS.charAt(Math.floor((leftChar + BASE) / 2));
        } else {
          mid += DIGITS.charAt(leftChar);
          i++;
          continue;
        }
      }

      if (leftChar === rightChar) {
        mid += DIGITS.charAt(leftChar);
        i++;
        continue;
      }

      if (rightChar - leftChar > 1) {
        mid += DIGITS.charAt(Math.floor((leftChar + rightChar) / 2));
        return mid;
      } else {
        // difference is exactly 1, we must append the left char and go to next digit
        mid += DIGITS.charAt(leftChar);
        i++;
        // we treat the next digit of right as 0 theoretically, but actually right terminates here, so it's BASE
        // the next digit of left is left.charAt(i) or 0
        // We will loop and the next iteration will handle the remaining string.
      }
    }
  }
}
