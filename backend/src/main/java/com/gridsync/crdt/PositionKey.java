package com.gridsync.crdt;

import java.util.Random;

public class PositionKey {

    private static final String DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    private static final int BASE = 62;
    private static final Random random = new Random();

    /**
     * Generates a position key between left and right.
     * Left and right can be null (indicating boundaries of the list).
     */
    public static String generate(String left, String right) {
        String mid = midpoint(left == null ? "" : left, right == null ? "" : right);
        // Append a random tiebreak character to minimize identical position keys from concurrent inserts
        // which makes sorting deterministic and collision-free most of the time without coordination.
        return mid + DIGITS.charAt(random.nextInt(BASE));
    }

    /**
     * Calculates the exact lexicographical midpoint between two base-62 strings.
     */
    public static String midpoint(String left, String right) {
        if (left != null && right != null && !right.isEmpty() && left.compareTo(right) >= 0) {
            throw new IllegalArgumentException("left (" + left + ") must be less than right (" + right + ")");
        }

        StringBuilder mid = new StringBuilder();
        int i = 0;
        
        while (true) {
            int leftChar = i < left.length() ? DIGITS.indexOf(left.charAt(i)) : 0;
            int rightChar = i < right.length() ? DIGITS.indexOf(right.charAt(i)) : BASE;
            
            if (i == 0 && left.isEmpty() && right.isEmpty()) {
                // Between start and end
                return String.valueOf(DIGITS.charAt(BASE / 2));
            }
            if (i == 0 && left.isEmpty()) {
                // Between start and right
                if (rightChar > 1) {
                    return String.valueOf(DIGITS.charAt(rightChar / 2));
                } else {
                    mid.append(DIGITS.charAt(0));
                    i++;
                    continue;
                }
            }
            if (i == 0 && right.isEmpty()) {
                // Between left and end
                if (leftChar < BASE - 2) { // Need room to go up
                    return left.substring(0, i) + DIGITS.charAt((leftChar + BASE) / 2);
                } else {
                    mid.append(DIGITS.charAt(leftChar));
                    i++;
                    continue;
                }
            }

            if (leftChar == rightChar) {
                mid.append(DIGITS.charAt(leftChar));
                i++;
                continue;
            }

            if (rightChar - leftChar > 1) {
                mid.append(DIGITS.charAt((leftChar + rightChar) / 2));
                return mid.toString();
            } else {
                // difference is exactly 1, we must append the left char and go to next digit
                mid.append(DIGITS.charAt(leftChar));
                i++;
                // we treat the next digit of right as 0 theoretically, but actually right terminates here, so it's BASE
                // the next digit of left is left.charAt(i) or 0
                // We will loop and the next iteration will handle the remaining string.
            }
        }
    }
}
