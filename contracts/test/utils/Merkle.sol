// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// The vault's Merkle tree, rebuilt offchain-style for tests: leaves paired left to right, a node
/// without a partner moves up unchanged, pairs hashed in sorted order.
library Merkle {
    function leaf(uint256 index, address code) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(index, code));
    }

    function pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function root(address[] memory codes) internal pure returns (bytes32) {
        (bytes32 r,) = _walk(codes, 0);
        return r;
    }

    function proof(address[] memory codes, uint256 index) internal pure returns (bytes32[] memory) {
        (, bytes32[] memory p) = _walk(codes, index);
        return p;
    }

    function _walk(address[] memory codes, uint256 index) private pure returns (bytes32, bytes32[] memory) {
        uint256 n = codes.length;
        bytes32[] memory layer = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            layer[i] = leaf(i, codes[i]);
        }
        bytes32[] memory path = new bytes32[](8);
        uint256 used;
        uint256 pos = index;
        while (n > 1) {
            bool promoted = n % 2 == 1 && pos == n - 1;
            if (!promoted) path[used++] = layer[pos ^ 1];
            uint256 half = n / 2;
            for (uint256 i; i < half; ++i) {
                layer[i] = pair(layer[2 * i], layer[2 * i + 1]);
            }
            if (n % 2 == 1) {
                layer[half] = layer[n - 1];
                n = half + 1;
            } else {
                n = half;
            }
            pos /= 2;
        }
        bytes32[] memory out = new bytes32[](used);
        for (uint256 i; i < used; ++i) {
            out[i] = path[i];
        }
        return (layer[0], out);
    }
}
