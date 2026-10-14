<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->string('category', 80)->nullable()->after('title');
            $table->text('banner_url')->nullable()->after('description');
            $table->foreignId('organizer_user_id')
                ->nullable()
                ->after('organizer')
                ->constrained('user_accounts')
                ->nullOnDelete();
        });

        $accounts = DB::table('user_accounts')
            ->where('role', 'Organizer')
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->get(['id', 'name']);
        $nameCounts = $accounts->countBy(fn ($account) => mb_strtolower(trim($account->name)));

        foreach ($accounts as $account) {
            $key = mb_strtolower(trim($account->name));
            if (($nameCounts[$key] ?? 0) !== 1) {
                continue;
            }

            DB::table('events')
                ->whereNull('organizer_user_id')
                ->whereRaw('LOWER(organizer) = ?', [$key])
                ->update(['organizer_user_id' => $account->id]);
        }
    }

    public function down(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->dropConstrainedForeignId('organizer_user_id');
            $table->dropColumn(['category', 'banner_url']);
        });
    }
};
