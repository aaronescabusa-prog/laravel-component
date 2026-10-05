<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('events', function (Blueprint $table) {
            $table->id();
            $table->string('reference')->unique();
            $table->string('title');
            $table->string('category')->default('General');
            $table->string('organizer')->nullable();
            $table->date('event_date')->nullable();
            $table->string('start_time')->nullable();
            $table->string('venue')->nullable();
            $table->text('description')->nullable();
            $table->unsignedInteger('budget')->nullable();
            $table->unsignedInteger('capacity')->nullable();
            $table->unsignedInteger('participants')->nullable()->default(0);
            $table->string('status')->default('Draft');
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('events');
    }
};
