#!/bin/sh

set -eu

die() {
	printf 'Error: %s\n' "$*" >&2
	exit 1
}

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || die "run this from inside the repository"
cd "$repo_root"

latest_release() {
	git tag --list 'tutanota-desktop-release-*' --sort=-version:refname |
		grep -E '^tutanota-desktop-release-[0-9]+\.[0-9]+\.[0-9]+$' |
		sed -n '1p'
}

next_ellie_release_tag() {
	release=$1
	version=${release#tutanota-desktop-release-}
	latest_revision=$(git tag --list "ellie-release-$version-r*" |
		sed -n "s/^ellie-release-$version-r\([0-9][0-9]*\)$/\1/p" |
		sort -n |
		sed -n '$p')
	latest_revision=${latest_revision:-0}
	printf 'ellie-release-%s-r%s\n' "$version" "$((latest_revision + 1))"
}

use_required_node() {
	if command -v fnm >/dev/null 2>&1 && [ -f .nvmrc ]; then
		eval "$(fnm env --shell bash)"
		fnm use --install-if-missing "$(cat .nvmrc)"
	fi
}

run_automated_checks() {
	root=$1
	cd "$root"
	use_required_node
	node "$repo_root/fork-maintenance/check-environment.mjs" "$root"
	git submodule sync --recursive
	git submodule update --init --recursive
	npm ci
	node desktop release --custom-desktop-release --unpacked
	npm run mail:types
	npm test
}

run_manual_check() {
	root=$1
	label=$2
	case "$(uname -s)" in
		Darwin)
			app_path=$(find "$root/artifacts/desktop" -type d -name '*.app' -print 2>/dev/null | sed -n '1p')
			[ -n "$app_path" ] || die "could not find the unpacked macOS application"
			launch_command="open -W '$app_path'"
			;;
		Linux)
			app_path=$(find "$root/artifacts/desktop" -type f -perm -111 -print 2>/dev/null | sed -n '1p')
			[ -n "$app_path" ] || die "could not find the unpacked Linux application"
			launch_command="'$app_path'"
			;;
		*) die "manual launch discovery is not implemented for $(uname -s)" ;;
	esac
	printf '\nLaunch the %s build with:\n' "$label"
	printf '  %s\n' "$launch_command"
	printf 'Confirm that login works, the mailbox loads, and basic send/receive behavior works.\n'
	printf 'Type yes after the smoke test passes: '
	read -r answer
	[ "$answer" = "yes" ] || die "$label failed manual validation"
}

validate_and_publish() {
	release=$1
	release_commit=$(git rev-parse "$release^{commit}")
	cd "$repo_root"
	[ "$(git branch --show-current)" = "master" ] || die "check out master before publishing"
	[ -z "$(git status --porcelain)" ] || die "the working tree has uncommitted or untracked changes"
	[ "$(git merge-base master "$release_commit")" = "$release_commit" ] || die "master is not based on $release"
	merge_commits=$(git rev-list --merges --count "$release_commit..master")
	[ "$merge_commits" -eq 0 ] || die "master contains merge commits; rebuild the fork stack before publishing"

	printf '\nValidating the rebased fork...\n'
	run_automated_checks "$repo_root"
	cd "$repo_root"
	npm run check:preflight
	[ -z "$(git status --porcelain)" ] || die "validation changed source files; inspect them before publishing"
	run_manual_check "$repo_root" "rebased fork"

	git fetch origin master --tags
	git fetch upstream --tags
	[ "$(latest_release)" = "$release" ] || die "a newer upstream release appeared; restart the update"
	expected_origin=$(git rev-parse origin/master)
	ellie_tag=$(next_ellie_release_tag "$release")
	git ls-remote --exit-code --refs origin "refs/tags/$ellie_tag" >/dev/null 2>&1 && die "release tag $ellie_tag already exists on origin"
	[ -z "$(git tag --list "$ellie_tag")" ] || die "release tag $ellie_tag already exists locally"
	printf 'Type publish to update origin/master and create %s: ' "$ellie_tag"
	read -r answer
	[ "$answer" = "publish" ] || die "publication cancelled"
	# The repository's upstream-derived pre-push hook rejects every direct push to
	# master. This fork intentionally publishes its tested rebase directly, so
	# bypass only that local hook while retaining the exact remote-state lease.
	git tag -a "$ellie_tag" -m "Ellie release $ellie_tag" -m "Upstream release: $release\nUpstream commit: $release_commit\nDownstream commit: $(git rev-parse HEAD)"
	git push --atomic --no-verify --force-with-lease="refs/heads/master:$expected_origin" origin master "refs/tags/$ellie_tag"
	printf 'Published master rebased onto %s and tagged it as %s.\n' "$release" "$ellie_tag"
}

if [ "${1:-}" = "--finish" ] || [ "${1:-}" = "--release" ]; then
	[ -n "${2:-}" ] || die "usage: $0 [--finish|--release] <release-tag>"
	validate_and_publish "$2"
	exit 0
fi

[ "$#" -eq 0 ] || die "usage: $0 [--finish|--release <release-tag>]"
[ "$(git branch --show-current)" = "master" ] || die "check out master before updating"
[ ! -d "$(git rev-parse --git-path rebase-merge)" ] || die "a rebase is already in progress"
[ ! -d "$(git rev-parse --git-path rebase-apply)" ] || die "a rebase is already in progress"
[ -z "$(git status --porcelain)" ] || die "the working tree has uncommitted or untracked changes"

git fetch origin master
git fetch upstream --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)" ] || die "master must exactly match origin/master"

release=$(latest_release)
[ -n "$release" ] || die "no upstream production release tag was found"
release_commit=$(git rev-parse "$release^{commit}")
printf 'Updating from newest upstream production release %s at %s.\n' "$release" "$release_commit"
base=$(git merge-base master "$release_commit")
merge_commits=$(git rev-list --merges --count "$base..master")
[ "$merge_commits" -eq 0 ] || die "the fork stack contains merge commits; handle them deliberately before rebasing"
timestamp=$(date '+%Y%m%d-%H%M%S')
backup="backup/master-before-upstream-rebase-$timestamp"
git branch "$backup" master
printf 'Created safety branch %s.\n' "$backup"

if ! git rebase "$release_commit"; then
	printf '\nResolve conflicts and run git rebase --continue until complete. Then run:\n' >&2
	printf '  %s --finish %s\n' "$repo_root/fork-maintenance/update-from-upstream-release.sh" "$release" >&2
	printf 'Use git rebase --abort to abandon the update. Safety branch: %s\n' "$backup" >&2
	exit 1
fi

validate_and_publish "$release"
