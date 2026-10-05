<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * duration_unit had a default of 'Hours', which is wrong now that the
     * duration is derived: an event with no end date has no unit either, and a
     * stray 'Hours' next to a null length reads as though one was recorded.
     *
     * It mattered in practice. Event::syncDuration() only marks the attributes
     * dirty when they actually change, so on insert both were already null and
     * were therefore left out of the INSERT entirely - letting the column
     * default decide, and the row came back with 'Hours'.
     */
    public function up(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->string('duration_unit', 10)->nullable()->default(null)->change();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->string('duration_unit', 10)->nullable()->default('Hours')->change();
        });
    }
};