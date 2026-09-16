import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');

describe('C++ compile_commands contract', () => {
    const cmake = readFileSync(join(ROOT, 'cpp', 'CMakeLists.txt'), 'utf8');

    it('does not symlink compile_commands.json to whichever tree last built', () => {
        expect(cmake).not.toMatch(/create_symlink/);
    });

    it('only copies compile_commands.json from the non-sanitizer build-host tree', () => {
        expect(cmake).toMatch(/NOT STREETVIEW_SANITIZERS/);
        expect(cmake).toMatch(/build-host/);
        expect(cmake).toMatch(/copy_if_different/);
        expect(cmake).toMatch(/compile_commands\.json/);
    });

    it('puts bindings.cpp on the host target so lint:cpp sees it in the database', () => {
        expect(cmake).toMatch(
            /add_library\(streetview_cpu STATIC src\/noise_module\.cpp src\/hrtf_module\.cpp src\/bindings\.cpp\)/,
        );
    });
});
