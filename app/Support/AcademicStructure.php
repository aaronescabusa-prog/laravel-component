<?php

namespace App\Support;

final class AcademicStructure
{
    public const COURSES = [
        'BS Information Technology',
        'BS Criminology',
        'BS Office Administration',
        'BS Education Major in English',
        'Bachelor of Elementary Education',
        'BA Political Science',
        'BA Communications',
    ];

    public const DEPARTMENTS = [
        [
            'code' => 'CCS',
            'name' => 'College of Computer Studies',
            'courses' => ['BS Information Technology'],
        ],
        [
            'code' => 'COAD',
            'name' => 'College of Office Administration',
            'courses' => ['BS Office Administration'],
        ],
        [
            'code' => 'COED',
            'name' => 'College of Education',
            'courses' => ['BS Education Major in English', 'Bachelor of Elementary Education'],
        ],
        [
            'code' => 'CAS',
            'name' => 'College of Arts and Sciences',
            'courses' => ['BA Political Science', 'BA Communications'],
        ],
        [
            'code' => 'CCJE',
            'name' => 'College of Criminal Justice Education',
            'courses' => ['BS Criminology'],
        ],
    ];

    public const YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];

    /**
     * @return list<string>
     */
    public static function courses(): array
    {
        return self::COURSES;
    }

    /** Normalize the short course labels used by the Flutter prototype. */
    public static function normalizeCourse(?string $course): ?string
    {
        $value = trim((string) $course);

        foreach (self::COURSES as $canonical) {
            if (strcasecmp($value, $canonical) === 0) {
                return $canonical;
            }
        }

        $aliases = [
            'bsit' => 'BS Information Technology',
            'bscrim' => 'BS Criminology',
            'bs crim' => 'BS Criminology',
            'bsoa' => 'BS Office Administration',
            'bsed' => 'BS Education Major in English',
            'bsed - english' => 'BS Education Major in English',
            'beed' => 'Bachelor of Elementary Education',
            'ba - polsci' => 'BA Political Science',
            'ab political science' => 'BA Political Science',
            'ba - comm' => 'BA Communications',
            'ab communication' => 'BA Communications',
        ];

        return $aliases[strtolower($value)] ?? null;
    }

    /** Normalize numeric and ordinal year values from mobile clients. */
    public static function normalizeYear(?string $year): ?string
    {
        $value = trim((string) $year);

        foreach (self::YEARS as $canonical) {
            if (strcasecmp($value, $canonical) === 0) {
                return $canonical;
            }
        }

        if (preg_match('/^(?:year\\s*)?([1-4])(?:st|nd|rd|th)?(?:\\s*year)?$/i', $value, $matches)) {
            return self::YEARS[((int) $matches[1]) - 1];
        }

        return null;
    }

    /**
     * @return list<string>
     */
    public static function coursesForDepartment(?string $code): array
    {
        foreach (self::DEPARTMENTS as $department) {
            if ($department['code'] === $code) {
                return $department['courses'];
            }
        }

        return [];
    }

    public static function departmentCodeForCourse(?string $course): ?string
    {
        $course = trim((string) $course);

        foreach (self::DEPARTMENTS as $department) {
            foreach ($department['courses'] as $departmentCourse) {
                if (strcasecmp($course, $departmentCourse) === 0) {
                    return $department['code'];
                }
            }
        }

        return null;
    }

    public static function departmentName(?string $code): ?string
    {
        foreach (self::DEPARTMENTS as $department) {
            if ($department['code'] === $code) {
                return $department['name'];
            }
        }

        return null;
    }
}
