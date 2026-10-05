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
        Schema::create('registrations', function (Blueprint $table) {
            $table->id();
            $table->string('reference')->unique();
            $table->string('participant');
            $table->string('email');
            $table->string('event');
            $table->string('payment')->nullable();
            $table->string('payment_status')->default('N/A');
            $table->string('attendance')->default('Not Yet Recorded');
            $table->string('reg_date')->nullable();
            $table->string('qr_code')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('registrations');
    }
};
