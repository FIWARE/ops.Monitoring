/*
 * Copyright 2013 Telefónica I+D
 * All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may obtain
 * a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 */


#ifndef ARGUMENT_PARSER_H
#define ARGUMENT_PARSER_H


#ifdef __cplusplus
extern "C" {
#endif


typedef struct option_value {
	int		opt;	/* option ('?' unknown, ':' missing value)    */
	int		err;	/* option that caused error (unknown/missing) */
	const char*	val;	/* option value, or NULL if an error is found */
} *option_list_t;


option_list_t parse_args(char* args, const char* optstr);


#ifdef __cplusplus
}
#endif


#endif /*ARGUMENT_PARSER_H*/
