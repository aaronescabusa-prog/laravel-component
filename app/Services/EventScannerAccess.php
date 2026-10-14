<?php

namespace App\Services;

use App\Models\Event;
use App\Models\UserAccount;

class EventScannerAccess
{
    public function allows(?UserAccount $account, Event $event): bool
    {
        if (! $account || $account->status !== 'Active') {
            return false;
        }

        if ($account->role === 'Admin') {
            return true;
        }

        return $account->role === 'Scanner'
            && $event->status === 'Approved'
            && $event->scannerAccounts()->whereKey($account->getKey())->exists();
    }

    public function authorize(?UserAccount $account, Event $event): void
    {
        abort_unless($this->allows($account, $event), 403, 'You are not assigned to scan this event.');
    }
}
