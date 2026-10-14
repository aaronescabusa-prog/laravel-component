<?php

use App\Models\Evaluation;
use App\Models\UserAccount;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;

uses(RefreshDatabase::class);

function evaluationAdminTestAccount(string $role, string $suffix): UserAccount
{
    return UserAccount::create([
        'reference' => 'USR-EVAL-'.$suffix,
        'name' => ucfirst(strtolower($role)).' Tester',
        'email' => strtolower($role).'-'.$suffix.'@tmc.edu.ph',
        'role' => $role,
        'status' => 'Active',
        'password' => 'password',
    ]);
}

test('admin can manage evaluation responses through the web api', function () {
    Sanctum::actingAs(evaluationAdminTestAccount('Admin', 'CRUD'));

    $this->postJson('/api/evaluations', [
        'reference' => 'EVL-CRUD-1',
        'event' => 'Leadership Seminar',
        'participant' => 'Student One',
        'rating' => 5,
        'comment' => 'Well organized.',
        'date' => '2026-10-14',
    ])->assertCreated()
        ->assertJsonPath('reference', 'EVL-CRUD-1');

    $this->getJson('/api/evaluations')
        ->assertOk()
        ->assertJsonPath('data.0.event', 'Leadership Seminar');

    $this->putJson('/api/evaluations/EVL-CRUD-1', [
        'rating' => 4,
        'comment' => 'Updated feedback.',
    ])->assertOk()
        ->assertJsonPath('rating', 4);

    $this->deleteJson('/api/evaluations/EVL-CRUD-1')->assertNoContent();

    $this->postJson('/api/evaluations', [
        'reference' => 'EVL-CRUD-1',
        'event' => 'Leadership Seminar',
        'participant' => 'Student One',
        'rating' => 3,
    ])->assertCreated();

    expect(Evaluation::withTrashed()->where('reference', 'EVL-CRUD-1')->count())->toBe(1)
        ->and(Evaluation::where('reference', 'EVL-CRUD-1')->value('rating'))->toBe(3);
});

test('evaluation management endpoints are restricted to admins', function () {
    Sanctum::actingAs(evaluationAdminTestAccount('Student', 'DENIED'));

    $this->getJson('/api/evaluations')->assertForbidden();
    $this->postJson('/api/evaluations', [
        'reference' => 'EVL-DENIED',
        'event' => 'Leadership Seminar',
        'participant' => 'Student One',
        'rating' => 5,
    ])->assertForbidden();
});

