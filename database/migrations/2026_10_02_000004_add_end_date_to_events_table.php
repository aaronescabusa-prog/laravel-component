<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * An event's length is described by where it ends, not by a number the
     * user types. end_date/end_time are therefore the source of truth, and the
     * duration_value/duration_unit pair added by the previous migration is
     * derived from this range on every write (see Event::deriveDuration()).
     *
     * An all-day event is simply the absence of start_time and end_time, so no
     * boolean column is needed for it.
     */
    public function up(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->date('end_date')->nullable()->after('event_date');
            $table->string('end_time', 20)->nullable()->after('start_time');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->dropColumn(['end_date', 'end_time']);
        });
    }
};