<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Which course an event is aimed at. This is deliberately separate from
     * target_role: the role decides who may act on the event, while this picks
     * the course whose students the event is offered to. NULL means the event
     * is public - offered to everyone and listed for search.
     */
    public function up(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->string('target_course')->nullable()->after('target_role');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->dropColumn('target_course');
        });
    }
};