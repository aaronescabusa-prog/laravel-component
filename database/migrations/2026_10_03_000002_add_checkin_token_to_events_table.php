<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Gives every event a stable check-in code for its QR poster.
 *
 * The code is what the printed QR encodes, so it must be unguessable and
 * stable for the life of the event. It is NOT an authorisation token: the
 * check-in endpoints stay behind auth:sanctum plus the role middleware, and
 * this only removes the need to tap an event id on a phone at a doorway.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->string('checkin_token', 64)->nullable()->unique()->after('has_certificate');
        });

        // Backfill in chunks: a single UPDATE ... WHERE token IS NULL over a
        // large table would hold one long lock on MySQL/MariaDB.
        DB::table('events')
            ->whereNull('checkin_token')
            ->orderBy('id')
            ->chunkById(200, function ($rows) {
                foreach ($rows as $row) {
                    DB::table('events')
                        ->where('id', $row->id)
                        ->update(['checkin_token' => $this->token()]);
                }
            });
    }

    public function down(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->dropUnique(['checkin_token']);
            $table->dropColumn('checkin_token');
        });
    }

    /**
     * 32 hex characters of CSPRNG output: 128 bits, so the code cannot be
     * guessed or walked by someone who photographs the poster.
     */
    private function token(): string
    {
        return bin2hex(random_bytes(16));
    }
};