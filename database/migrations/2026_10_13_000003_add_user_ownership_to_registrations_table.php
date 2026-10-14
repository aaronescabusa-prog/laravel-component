<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('registrations', function (Blueprint $table) {
            $table->foreignId('user_account_id')
                ->nullable()
                ->after('event_id')
                ->constrained('user_accounts')
                ->nullOnDelete();
        });

        DB::table('user_accounts')->orderBy('id')->chunkById(200, function ($accounts) {
            foreach ($accounts as $account) {
                DB::table('registrations')
                    ->whereNull('user_account_id')
                    ->whereRaw('LOWER(email) = ?', [mb_strtolower($account->email)])
                    ->update(['user_account_id' => $account->id]);
            }
        });
    }

    public function down(): void
    {
        Schema::table('registrations', function (Blueprint $table) {
            $table->dropConstrainedForeignId('user_account_id');
        });
    }
};
