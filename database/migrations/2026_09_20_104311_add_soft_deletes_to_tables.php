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
        Schema::table('user_accounts', function (Blueprint $table) {
            $table->softDeletes();
        });

        Schema::table('registrations', function (Blueprint $table) {
            $table->softDeletes();
        });

        Schema::table('events', function (Blueprint $table) {
            $table->softDeletes();
        });

        Schema::table('certificates', function (Blueprint $table) {
            $table->softDeletes();
        });

        Schema::table('announcements', function (Blueprint $table) {
            $table->softDeletes();
        });

        Schema::table('evaluations', function (Blueprint $table) {
            $table->softDeletes();
        });

        Schema::table('activity_logs', function (Blueprint $table) {
            $table->softDeletes();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('user_accounts', function (Blueprint $table) {
            $table->dropSoftDeletes();
        });

        Schema::table('registrations', function (Blueprint $table) {
            $table->dropSoftDeletes();
        });

        Schema::table('events', function (Blueprint $table) {
            $table->dropSoftDeletes();
        });

        Schema::table('certificates', function (Blueprint $table) {
            $table->dropSoftDeletes();
        });

        Schema::table('announcements', function (Blueprint $table) {
            $table->dropSoftDeletes();
        });

        Schema::table('evaluations', function (Blueprint $table) {
            $table->dropSoftDeletes();
        });

        Schema::table('activity_logs', function (Blueprint $table) {
            $table->dropSoftDeletes();
        });
    }
};