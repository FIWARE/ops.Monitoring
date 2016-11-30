#!/bin/sh
#
# Copyright 2016 Telefónica I+D
# All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License"); you may
# not use this file except in compliance with the License. You may obtain
# a copy of the License at
#
#         http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
# WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
# License for the specific language governing permissions and limitations
# under the License.
#

#
# Prepare a new release or hotfix for this component, automatically including
# changelog entries taken from descriptions of the pull requests been merged
# since last release (changes are committed into a new "release/X.Y.Z" branch)
# or from commits in the already existing "hotfix/???" branch.
#
# Usage:
#   $0 [--interactive] [NEW_RELEASE_NUMBER]
#   $0 [--help]
#
# Options:
#   -i, --interactive	edit changelog interactively before commit
#   -h, --help		show this help message and exit
#

OPTS='i(interactive)h(help)'
PROG=$(basename $0)

# Command line options
INTERACTIVE=
NEW_RELEASE_NUMBER=

# Command line processing
OPTERR=
OPTSTR=$(echo :-:$OPTS | sed 's/([a-zA-Z0-9]*)//g')
OPTHLP=$(sed -n -e 's/$0/'$PROG'/' -e '20,/^$/ s/^#[ ]\?//p' $0)
while getopts $OPTSTR OPT; do while [ -z "$OPTERR" ]; do
case $OPT in
'i')	INTERACTIVE=true;;
'h')	OPTERR="$OPTHLP";;
'?')	OPTERR="Unknown option -$OPTARG";;
':')	OPTERR="Missing value for option -$OPTARG";;
'-')	OPTLONG="${OPTARG%=*}";
	OPT=$(expr $OPTS : ".*\(.\)($OPTLONG):.*" '|' '?');
	if [ "$OPT" = '?' ]; then
		OPT=$(expr $OPTS : ".*\(.\)($OPTLONG).*" '|' '?')
		OPTARG=-$OPTLONG
	else
		OPTARG=$(echo =$OPTARG | cut -d= -f3)
		[ -z "$OPTARG" ] && { OPTARG=-$OPTLONG; OPT=':'; }
	fi;
	continue;;
esac; break; done; done
shift $(expr $OPTIND - 1)
[ -n "${NEW_RELEASE_NUMBER:=$1}" ] && shift
[ -z "$OPTERR" -a -n "$*" ] && OPTERR="Too many arguments"
[ -n "$OPTERR" ] && {
	PREAMBLE=$(printf "$OPTHLP" | sed -n '0,/^Usage:/ p' | head -n -1)
	USAGE="Usage:\n"$(printf "$OPTHLP" | sed '0,/^Usage:/ d')"\n\n"
	TAB=4; LEN=$(echo "$USAGE" | awk -F'\t' '/ .+\t/ {print $1}' | wc -L)
	TABSTOPS=$TAB,$(((LEN/TAB+2)*TAB)); WIDTH=${COLUMNS:-$(tput cols)}
	[ "$OPTERR" != "$OPTHLP" ] && PREAMBLE="ERROR: $OPTERR"
	printf "$PREAMBLE\n\n" | fmt -$WIDTH 1>&2
	printf "$USAGE" | tr -s '\t' | expand -t$TABSTOPS | fmt -$WIDTH -s 1>&2
	exit 1
}

# Common properties
PROGDIR=$(cd $(dirname $0); pwd)
BASEDIR=$(cd $PROGDIR/../..; pwd)
TMPFILE=$(mktemp --tmpdir $PROG_XXXXXX)
CUR_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Package properties
CHANGELOG=$TMPFILE.chg
CFGFILE=$BASEDIR/package.json
REPOURL=$(sed -n '/"artifacts"/,/}/ p' $CFGFILE | awk -F'{|"' '{printf $4}')
PACKAGE=$(sed -n '/^{/,/{/ p' $CFGFILE | awk -F'{|"' '/"name"/ {printf $4}')
VERSION=$(sed -n '/^{/,/{/ p' $CFGFILE | awk -F'{|"' '/"version"/ {printf $4}')
PRODUCT=$(awk '/"product"/,/\}/' $CFGFILE)
RELEASE=$(echo "$PRODUCT" | sed -n '/"release"/ {s/.*:.*"\(.*\)".*/\1/; p; q}')

# Function to check current branch
check_current_branch() {
	if [ -n "$(expr $CUR_BRANCH : '^\(release/.*\)$')" ]; then
		NEW_RELEASE_NUMBER=${CUR_BRANCH#release/}
		return 0
	elif [ -z "$(expr $CUR_BRANCH : '^\(develop\|hotfix/.*\)$')" ]; then
		printf "Must change to develop or hotfix branch first\n" 1>&2
		return 1
	elif [ "$CUR_BRANCH" = "develop" -a -z "$NEW_RELEASE_NUMBER" ]; then
		printf "Missing release number (type \`$PROG --help')\n" 1>&2
		return 1
	fi
}

# Function to get new changelog entries, edit interactively and write to file
get_changelog_entries() {
	local path="ngsi_adapter"
	local latest_tag=$(git tag -l | tail -1)
	local branch_types="hardening\|feature\|bug\|hotfix"
	local branch_regex=".*\($branch_types\)\/\([A-Z_-]*[0-9]*\).*"
	local options entry hash diff

	if [ -n "$(expr $CUR_BRANCH : '^\(hotfix/.*\)$')" ]; then
		options="--reverse --format=format:'%s'"
		eval git log $options master..HEAD > $CHANGELOG
	else
		options="--reverse --merges --grep=pull \
			--format=format:'%P %H - %s: %b%n'"
		eval git log $options $latest_tag..HEAD | while read entry; do
			hash="$(echo $entry | cut -d' ' -f1,2)"
			diff="$(git diff --name-only $hash | grep -v ^$path)"
			[ -z "$diff" ] && echo ${entry#* - }
			done \
			| sed 's/'$branch_regex': \(.*\)/\3 (\1 #\2)/' \
			| sed 's/\(.*\) (.* #)/\1/' \
			| sed 's/^/- /' > $CHANGELOG
	fi

	if [ ! -s $CHANGELOG ]; then
		printf "No changes at $path since last release\n" 1>&2
		return 1
	elif [ -n "$INTERACTIVE" ]; then
		${EDITOR:-vi} $CHANGELOG
	fi
}

# Function to create a new "release/X.Y.Z" branch if needed
get_changelog_branch() {
	if [ "$CUR_BRANCH" = "develop" ]; then
		git checkout -b release/$NEW_RELEASE_NUMBER
	fi
}

# Function to write changelog entries in MarkDown syntax (for GitHub releases)
write_changelog_markdown() {
	local markdown=$BASEDIR/CHANGELOG.md
	local component=$(echo $PACKAGE | tr '-' '_')
	local artifacts=$REPOURL
	cat > $markdown <<-EOF
		#### Changelog
		$(cat $CHANGELOG)

		#### Components
		- $component version $VERSION ([download])

		[download]:
		$artifacts
		"FIWARE Artifacts Repository"
	EOF
	printf "%s successfully created.\n" ${markdown#$BASEDIR/}
}

# Function to update .deb package changelog
update_deb_changelog() {
	local pkgchangelog=$PROGDIR/debian/changelog
	local pkgcontrol=$PROGDIR/debian/control
	local pkgmaint="$(grep ^Maintainer $pkgcontrol | cut -d' ' -f2-)"
	local pkgname="$(grep ^Package $pkgcontrol | cut -d' ' -f2-)"
	local pkgdist=$(head -1 $pkgchangelog | awk -F'[ ;]' '{printf $3}')
	local pkgversion=$(head -1 $pkgchangelog | awk -F'[()]' '{printf $2}')
	local pkgrevision=$(expr "$pkgversion" : "$VERSION-\([0-9]*\)" '|' 0)
	local header footer
	pkgversion=$VERSION-$((pkgrevision + 1))
	header="$pkgname ($pkgversion) ${pkgdist:-unstable}; urgency=low"
	footer=" -- $pkgmaint  $(LC_ALL=C date +'%a, %d %b %Y %T %z')"
	cp $CHANGELOG $TMPFILE
	sed -i "1i $header\n" $TMPFILE
	sed -i "s/^-/  \*/" $TMPFILE
	printf "\n$footer\n\n" >> $TMPFILE
	cat $pkgchangelog >> $TMPFILE
	mv $TMPFILE $pkgchangelog
	printf "%s successfully updated.\n" ${pkgchangelog#$BASEDIR/}
	git add $pkgchangelog
	git commit --message='Update changelog'
}

# Function to update .rpm package changelog
update_rpm_changelog() {
	local pkgspec=$PROGDIR/redhat/SPECS/*.spec
	local pkgmaint="$(grep ^Packager $pkgspec | cut -d' ' -f2-)"
	local pkgversion=$(awk '/^\*/ {printf $NF; exit}' $pkgspec)
	local pkgrevision=$(expr "$pkgversion" : "$VERSION-\([0-9]*\)" '|' 0)
	local header
	pkgversion=$VERSION-$((pkgrevision + 1))
	header="* $(LC_ALL=C date +'%a %b %d %Y') $pkgmaint $pkgversion"
	cp $CHANGELOG $TMPFILE
	sed -i "1i $header" $TMPFILE
	printf "\n" >> $TMPFILE
	sed -i -e "/^%changelog/r $TMPFILE" $pkgspec
	printf "%s successfully updated.\n" ${pkgspec#$BASEDIR/}
	git add $pkgspec
	git commit --message='Update changelog'
	rm $TMPFILE
}

# Function to change product release when needed
bump_product_release() {
	[ -n "$NEW_RELEASE_NUMBER" ] || return 0
	(cd $PROGDIR && bumpversion \
		--commit --no-tag --allow-dirty \
		--current-version=$RELEASE \
		--new-version=$NEW_RELEASE_NUMBER \
		--message='New product release {new_version}' \
		--search='"release": "{current_version}"' \
		--replace='"release": "{new_version}"' \
		patch $CFGFILE)
}

# Main
check_current_branch \
&& get_changelog_entries \
&& get_changelog_branch \
&& write_changelog_markdown \
&& update_deb_changelog \
&& update_rpm_changelog \
&& bump_product_release
rm -f $CHANGELOG
