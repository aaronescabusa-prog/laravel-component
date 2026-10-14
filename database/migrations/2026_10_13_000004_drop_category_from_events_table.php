<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Event categories were removed from the product: events are described by
     * their audience and schedule, and the free-form category added a second
     * taxonomy nothing filtered on. Dropping the column keeps the table honest
     * rather than carrying a dead field every write would have to keep in step.
     */
    public function up(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->dropColumn('category');
        });
    }

    public function down(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->string('category')->default('General')->after('title');
        });
    }
};
