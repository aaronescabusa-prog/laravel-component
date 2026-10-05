<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

abstract class Controller
{
    /**
     * Largest page a client may request. Listing endpoints are unbounded
     * otherwise, so a single `per_page=1000000` would pull the whole table
     * into memory.
     */
    protected const MAX_PER_PAGE = 200;

    /**
     * The page size for a listing request, clamped to a sane range.
     *
     * Non-numeric, zero and negative values fall back to the default rather
     * than reaching the paginator, which would otherwise treat them as
     * "return everything".
     */
    protected function perPage(Request $request, int $default = 15): int
    {
        $perPage = $request->integer('per_page', $default);

        if ($perPage < 1) {
            return $default;
        }

        return min($perPage, static::MAX_PER_PAGE);
    }
}
