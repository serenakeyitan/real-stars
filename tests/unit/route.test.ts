import { describe, it, expect } from 'vitest';
import { parseRepoFromUrl } from '@/content/route';

describe('parseRepoFromUrl', () => {
  it('parses a basic repo URL', () => {
    expect(parseRepoFromUrl('https://github.com/torvalds/linux')).toEqual({
      owner: 'torvalds',
      name: 'linux',
    });
  });

  it('parses with trailing slash', () => {
    expect(parseRepoFromUrl('https://github.com/microsoft/vscode/')).toEqual({
      owner: 'microsoft',
      name: 'vscode',
    });
  });

  it('returns null for the GitHub home page', () => {
    expect(parseRepoFromUrl('https://github.com/')).toBeNull();
  });

  it('returns null for a user profile (single segment)', () => {
    expect(parseRepoFromUrl('https://github.com/torvalds')).toBeNull();
  });

  it('returns null for nested paths (issues, pulls, tree, etc)', () => {
    expect(parseRepoFromUrl('https://github.com/torvalds/linux/issues')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/torvalds/linux/pull/123')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/torvalds/linux/tree/main')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/torvalds/linux/blob/main/README')).toBeNull();
  });

  it('returns null for reserved GitHub paths', () => {
    expect(parseRepoFromUrl('https://github.com/settings/profile')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/marketplace/something')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/topics/javascript')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/issues')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/pulls')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/notifications')).toBeNull();
    expect(parseRepoFromUrl('https://github.com/explore')).toBeNull();
  });

  it('returns null for non-github hosts', () => {
    expect(parseRepoFromUrl('https://gitlab.com/foo/bar')).toBeNull();
    expect(parseRepoFromUrl('https://example.com/torvalds/linux')).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseRepoFromUrl('not a url')).toBeNull();
    expect(parseRepoFromUrl('')).toBeNull();
  });

  it('handles owner/repo names with dots, dashes, underscores', () => {
    expect(parseRepoFromUrl('https://github.com/some-org/repo.name_v2')).toEqual({
      owner: 'some-org',
      name: 'repo.name_v2',
    });
  });

  it('rejects names with spaces or special chars', () => {
    expect(parseRepoFromUrl('https://github.com/foo bar/baz')).toBeNull();
  });

  it('strips query and hash before parsing', () => {
    expect(parseRepoFromUrl('https://github.com/torvalds/linux?tab=readme')).toEqual({
      owner: 'torvalds',
      name: 'linux',
    });
    expect(parseRepoFromUrl('https://github.com/torvalds/linux#contents')).toEqual({
      owner: 'torvalds',
      name: 'linux',
    });
  });
});
