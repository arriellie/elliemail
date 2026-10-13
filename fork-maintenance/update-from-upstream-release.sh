#!/bin/sh

set -eu

die() {
	printf 'Error: %s\n' "$*" >&2
	exit 1
}

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || die "run this from inside the repository"
cd "$repo_root"

mode=update
release=
validate_only=false
resume=false
while [ "$#" -gt 0 ]; do
	case "$1" in
		--finish|--release)
			[ "$mode" = update ] && [ "$#" -ge 2 ] || die "specify one release mode and a release tag"
			mode=${1#--}; release=$2; shift 2 ;;
		--check) [ "$mode" = update ] || die "specify one mode"; mode=check; shift ;;
		--validate-only) validate_only=true; shift ;;
		--resume) resume=true; shift ;;
		*) die "usage: $0 [--check|--finish TAG|--release TAG] [--validate-only] [--resume]" ;;
	esac
done

fetch_releases() {
	# Do not fetch hundreds of unrelated upstream development branches.
	git fetch --quiet --no-tags upstream 'refs/tags/tutanota-desktop-release-*:refs/tags/tutanota-desktop-release-*'
}

fetch_origin() {
	git fetch --quiet --no-tags origin master 'refs/tags/ellie-release-*:refs/tags/ellie-release-*'
}

state_dir=$(git rev-parse --git-path fork-maintenance)
mkdir -p "$state_dir"
lease_file="$state_dir/publication-lease"

capture_lease() {
	if [ -f "$lease_file" ] && [ "$(sed -n '1p' "$lease_file")" = "$release" ]; then
		expected_origin=$(sed -n '2p' "$lease_file")
	else
		[ "$mode" != finish ] || die "saved publication lease missing; start with --release $release"
		expected_origin=$(git rev-parse origin/master)
		printf '%s\n%s\n' "$release" "$expected_origin" > "$lease_file"
	fi
	[ "$(git rev-parse origin/master)" = "$expected_origin" ] || die "origin/master changed since this update started; inspect remote changes before restarting"
}

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
	if "$resume"; then
		node "$repo_root/fork-maintenance/validation.mjs" --resume
	else
		node "$repo_root/fork-maintenance/validation.mjs"
	fi
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
			app_path="$root/artifacts/desktop/linux-unpacked/elliemail-desktop"
			[ -x "$app_path" ] || die "could not find the unpacked Linux application"
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
	printf '%s\n' "$release" | grep -Eq '^tutanota-desktop-release-[0-9]+\.[0-9]+\.[0-9]+$' || die "not a production desktop release tag: $release"
	fetch_releases
	[ "$(latest_release)" = "$release" ] || die "select the latest published release: $(latest_release)"
	release_commit=$(git rev-parse "$release^{commit}")
	cd "$repo_root"
	[ "$(git branch --show-current)" = "master" ] || die "check out master before publishing"
	[ -z "$(git status --porcelain)" ] || die "the working tree has uncommitted or untracked changes"
	[ "$(git merge-base master "$release_commit")" = "$release_commit" ] || die "master is not based on $release"
	merge_commits=$(git rev-list --merges --count "$release_commit..master")
	[ "$merge_commits" -eq 0 ] || die "master contains merge commits; rebuild the fork stack before publishing"
	fetch_origin
	capture_lease
	validated_head=$(git rev-parse HEAD)

	printf '\nValidating the rebased fork...\n'
	run_automated_checks "$repo_root"
	cd "$repo_root"
	[ -z "$(git status --porcelain)" ] || die "validation changed source files; inspect them before publishing"
	[ "$(git rev-parse HEAD)" = "$validated_head" ] || die "HEAD changed during validation"
	if "$validate_only"; then
		printf '\nReady for manual smoke testing. To resume without repeating unchanged checks:\n'
		printf '  %s --finish %s --resume\n' "$repo_root/fork-maintenance/update-from-upstream-release.sh" "$release"
		return
	fi
	run_manual_check "$repo_root" "rebased fork"

	fetch_origin
	fetch_releases
	[ "$(latest_release)" = "$release" ] || die "a newer upstream release appeared; restart the update"
	[ "$(git rev-parse origin/master)" = "$expected_origin" ] || die "origin/master changed during validation; publication stopped"
	[ -z "$(git status --porcelain)" ] || die "source changed during the smoke test"
	[ "$(git rev-parse HEAD)" = "$validated_head" ] || die "HEAD changed during the smoke test"
	ellie_tag=$(next_ellie_release_tag "$release")
	git ls-remote --exit-code --refs origin "refs/tags/$ellie_tag" >/dev/null 2>&1 && die "release tag $ellie_tag already exists on origin"
	[ -z "$(git tag --list "$ellie_tag")" ] || die "release tag $ellie_tag already exists locally"
	printf 'Type publish to update origin/master and create %s: ' "$ellie_tag"
	read -r answer
	[ "$answer" = "publish" ] || die "publication cancelled"
	# The repository's upstream-derived pre-push hook rejects every direct push to
	# master. This fork intentionally publishes its tested rebase directly, so
	# bypass only that local hook while retaining the exact remote-state lease.
	git tag -a "$ellie_tag" -m "Ellie release $ellie_tag" -m "$(printf 'Upstream release: %s\nUpstream commit: %s\nDownstream commit: %s' "$release" "$release_commit" "$(git rev-parse HEAD)")"
	if ! git push --atomic --no-verify --force-with-lease="refs/heads/master:$expected_origin" origin master "refs/tags/$ellie_tag"; then
		git tag -d "$ellie_tag"
		die "atomic publication failed; the saved lease and validation receipt are retained"
	fi
	rm -f "$lease_file"
	printf 'Published master rebased onto %s and tagged it as %s.\n' "$release" "$ellie_tag"
}

if [ "$mode" = check ]; then
	fetch_releases
	release=$(latest_release)
	[ -n "$release" ] || die "no upstream production release tag was found"
	printf 'Latest upstream release: %s\n' "$release"
	printf 'Current branch: %s at %s\n' "$(git branch --show-current)" "$(git rev-parse --short HEAD)"
	if git merge-base --is-ancestor "$release" HEAD; then
		printf 'Already based on the latest upstream release.\n'
	else
		printf 'An upstream update is available.\n'
	fi
	exit 0
fi

[ ! -d "$(git rev-parse --git-path rebase-merge)" ] || die "a rebase is already in progress"
[ ! -d "$(git rev-parse --git-path rebase-apply)" ] || die "a rebase is already in progress"
if [ "$mode" = finish ] || [ "$mode" = release ]; then
	validate_and_publish "$release"
	exit 0
fi

[ "$(git branch --show-current)" = "master" ] || die "check out master before updating"
[ -z "$(git status --porcelain)" ] || die "the working tree has uncommitted or untracked changes"

fetch_origin
fetch_releases
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/master)" ] || die "master must exactly match origin/master"

release=$(latest_release)
[ -n "$release" ] || die "no upstream production release tag was found"
release_commit=$(git rev-parse "$release^{commit}")
if git merge-base --is-ancestor "$release_commit" HEAD; then
	if git tag --points-at HEAD --list "ellie-release-${release#tutanota-desktop-release-}-r*" | grep -q .; then
		printf 'Already published at the latest upstream release: %s.\n' "$release"
		exit 0
	fi
	die "already based on $release; validate the unpublished changes with --release $release"
fi
capture_lease
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
