<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // One uploaded template per event; the event's own record decides which
        // artwork a certificate is rendered onto.
        Schema::create('certificate_templates', function (Blueprint $table) {
            $table->id();
            $table->string('event')->unique();
            $table->string('name');
            $table->string('path');
            $table->unsignedInteger('width')->default(1123);   // A4 landscape @96dpi
            $table->unsignedInteger('height')->default(794);
            $table->timestamps();
        });

        // Delivery bookkeeping: a certificate can be rendered but never sent,
        // sent once, or bounced. Without this an admin cannot tell what the
        // students actually received.
        Schema::table('certificates', function (Blueprint $table) {
            $table->timestamp('sent_at')->nullable()->after('date_issued');
            $table->string('sent_to')->nullable()->after('sent_at');
            $table->string('send_status')->default('Not Sent')->after('sent_to');
            $table->text('send_error')->nullable()->after('send_status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('certificate_templates');

        Schema::table('certificates', function (Blueprint $table) {
            $table->dropColumn(['sent_at', 'sent_to', 'send_status', 'send_error']);
        });
    }
};