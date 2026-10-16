<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('event_obligations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('event_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_account_id')->constrained()->cascadeOnDelete();
            $table->string('student_reference', 50);
            $table->string('student_id', 20)->nullable();
            $table->string('student_name');
            $table->string('student_email');
            $table->string('department', 20)->nullable();
            $table->string('course')->nullable();
            $table->string('year', 20)->nullable();
            $table->string('block_no', 50)->nullable();
            $table->string('status', 32)->default('required');
            $table->timestamp('finalized_at');
            $table->timestamps();
            $table->unique(['event_id', 'user_account_id'], 'event_obligations_event_student_unique');
            $table->index(['event_id', 'status']);
        });

        Schema::create('obligation_attendances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('event_obligation_id')->constrained('event_obligations')->cascadeOnDelete();
            $table->foreignId('attendance_session_id')->constrained('attendance_sessions')->cascadeOnDelete();
            $table->timestamp('time_in')->nullable();
            $table->timestamp('time_out')->nullable();
            $table->string('status', 32)->default('Not Yet Recorded');
            $table->foreignId('recorded_by_user_id')->nullable()->constrained('user_accounts')->nullOnDelete();
            $table->timestamp('recorded_at')->nullable();
            $table->timestamps();
            $table->unique(['event_obligation_id', 'attendance_session_id'], 'obligation_attendances_obligation_session_unique');
        });

        Schema::create('student_fines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('event_obligation_id')->unique()->constrained('event_obligations')->cascadeOnDelete();
            $table->decimal('amount', 10, 2);
            $table->string('reason', 80);
            $table->string('assessment_status', 24)->default('proposed');
            $table->string('payment_status', 24)->default('unpaid');
            $table->decimal('amount_paid', 10, 2)->default(0);
            $table->foreignId('reviewed_by_user_id')->nullable()->constrained('user_accounts')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->text('review_note')->nullable();
            $table->timestamps();
            $table->index(['assessment_status', 'payment_status']);
        });

        Schema::create('excuse_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('event_obligation_id')->constrained('event_obligations')->cascadeOnDelete();
            $table->foreignId('user_account_id')->constrained()->cascadeOnDelete();
            $table->text('reason');
            $table->string('document_path')->nullable();
            $table->string('status', 24)->default('pending');
            $table->foreignId('reviewed_by_user_id')->nullable()->constrained('user_accounts')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->text('review_note')->nullable();
            $table->timestamps();
            $table->index(['event_obligation_id', 'status']);
        });

        Schema::create('fine_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_fine_id')->constrained()->cascadeOnDelete();
            $table->decimal('amount', 10, 2);
            $table->string('receipt_reference', 50)->unique();
            $table->string('method', 40)->default('Cash');
            $table->timestamp('paid_at');
            $table->foreignId('recorded_by_user_id')->nullable()->constrained('user_accounts')->nullOnDelete();
            $table->text('note')->nullable();
            $table->timestamps();
        });

        Schema::create('fine_audit_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('student_fine_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('event_obligation_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('actor_user_id')->nullable()->constrained('user_accounts')->nullOnDelete();
            $table->string('action', 50);
            $table->json('details')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fine_audit_logs');
        Schema::dropIfExists('fine_payments');
        Schema::dropIfExists('excuse_requests');
        Schema::dropIfExists('student_fines');
        Schema::dropIfExists('obligation_attendances');
        Schema::dropIfExists('event_obligations');
    }
};
